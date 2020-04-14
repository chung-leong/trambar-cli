#!/usr/bin/env node

var _ = require('lodash');
var OS = require('os');
var FS = require('fs'); FS.mkdirpSync = require('mkdirp').sync;
var Path = require('path');
var ChildProcess = require('child_process');
var Crypto = require('crypto');
var BcryptJS = require('bcryptjs');
var CommandLineArgs = require('command-line-args');
var CommandLineUsage = require('command-line-usage');
var ReadlineSync = require('readline-sync');
var IsRoot = require('is-root');
var CommonDir = require('commondir');

var defaultPrefix = 'trambar';
var defaultPassword = 'password';
var defaultBuild = 'latest';
var defaultConfigFolder;
var defaultSourceFolder;
var defaultTemplateFolder;
var virtualization;
var virtualVolumes = [];
var cronAvailable;

switch (OS.type()) {
  case 'Linux':
    var home = process.env.HOME;
    defaultConfigFolder = '/etc/trambar';
    defaultSourceFolder = home + '/trambar';
    defaultTemplateFolder = home + '/trambar-generic';
    virtualization = false;
    cronAvailable = FS.existsSync('/etc/cron.d');
    break;
  case 'Windows_NT':
    var home = _.replace(process.env.USERPROFILE, /\\/g, '/');
    defaultConfigFolder = home + '/Trambar';
    defaultSourceFolder = home + '/trambar';
    virtualization = true;
    cronAvailable = false;
    break;
  case 'Darwin':
    var home = process.env.HOME;
    defaultConfigFolder = home + '/Trambar';
    defaultSourceFolder = home + '/trambar';
    virtualization = true;
    cronAvailable = false;
    break;
  default:
    console.log('Unsupported operation system', OS.type());
    process.exit(-1);
}

var optionDefinitions = [
  {
    name: '*',
    type: String,
    multiple: true,
    defaultOption: true,
  },
  {
    name: 'build',
    alias: 'b',
    type: String,
    description: 'Specify Trambar build (default: ' + defaultBuild + ')'
  },
  {
    name: 'config',
    alias: 'c',
    type: String,
    description: 'Specify config directory (default: ' + defaultConfigFolder + ')'
  },
  {
    name: 'dev',
    alias: 'd',
    type: Boolean,
    description: 'Use development configuration',
  },
/*
  {
    name: 'inspect',
    alias: 'i',
    type: Boolean,
    description: 'Start service in debugger',
  },
*/
  {
    name: 'help',
    alias: 'h',
    type: Boolean,
    description: 'Print this usage guide'
  },
  {
    name: 'prefix',
    alias: 'p',
    type: String,
    description: 'Specify Docker container prefix (default: ' + defaultPrefix + ')'
  },
  {
    name: 'version',
    alias: 'v',
    type: Boolean,
    description: 'Show version number'
  },
  {
    name: 'yes',
    alias: 'y',
    type: Boolean,
    description: 'Automatic yes to prompts'
  },
];
var scriptDescription = [
  {
    header: 'Trambar',
    content: 'A utility for installing and managing a Trambar server'
  },
  {
    header: 'Commands',
    content: [
      { name: 'compose', summary: 'Edit Trambar Docker Compose configuration file' },
      { name: 'env', summary: 'Edit Trambar environment variables' },
      { name: 'install', summary: 'Download Docker images and create default configuration' },
      { name: 'logs', summary: 'Show Trambar server logs' },
      { name: 'password', summary: 'Set password of root account' },
      { name: 'restart', summary: 'Restart Trambar' },
      { name: 'start', summary: 'Start Trambar' },
      { name: 'stats', summary: 'Show Trambar CPU and memory usage' },
      { name: 'stop', summary: 'Stop Trambar' },
      { name: 'update', summary: 'Pull latest images and restart Trambar' },
      { name: 'uninstall', summary: 'Remove Trambar images and configuration' },
    ]
  },
  {
    header: 'Certbot commands',
    content: [
      { name: 'add', summary: 'Add domain names' },
      { name: 'list', summary: 'List domain names' },
      { name: 'remove', summary: 'Remove domain names' },
      { name: 'renew', summary: 'Renew certifcate' },
      { name: 'request', summary: 'Request new certificate' },
    ]
  },
  {
    header: 'Options',
    optionList: _.filter(optionDefinitions, function(def) {
      return !def.defaultOption;
    })
  },
];

var options = CommandLineArgs(optionDefinitions);
var command = _.get(options, [ '*', 0 ]);
var args = _.slice(_.get(options, '*'), 1);
if (command) {
  if (!runCommand(command)) {
    process.exit(-1);
  }
} else {
  if (options.version) {
    var version = getVersion();
    console.log('Trambar version ' + version);
  } else {
    var usage = CommandLineUsage(scriptDescription);
    console.log(usage);
  }
}
process.exit(0);

function runCommand(command) {
  switch (_.toLower(command)) {
    case 'compose':
      return editCompose();
    case 'env':
      return editEnv();
    case 'install':
      return install();
    case 'logs':
      return showLogs();
    case 'password':
      return setPassword();
    case 'restart':
      return restart();
    case 'start':
      return start();
    case 'stats':
      return showStats();
    case 'stop':
      return stop();
    case 'update':
      return update();
    case 'uninstall':
      return uninstall();
    case 'add':
      return addDomainNames();
    case 'list':
      return listDomainNames();
    case 'remove':
      return removeDomainNames();
    case 'renew':
      return renewCertificate();
    case 'request':
      return requestCertificate();
    default:
      console.log('Unknown command: ' + command);
      return false;
  }
}

function editCompose() {
  if (!checkRootAccess()) {
    return false;
  }
  editTextFile('docker-compose.yml');
}

function editEnv() {
  if (!checkRootAccess()) {
    return false;
  }
  editTextFile('.env');
}

function setPassword() {
  if (!checkRootAccess()) {
    return false;
  }
  var password = promptForPassword('Password:');
  if (!writePasswordFile('./trambar.htpasswd', password)) {
    return false;
  }
  return true;
}

function install() {
  if (!checkRootAccess()) {
    return false;
  }
  if (!createConfiguration()) {
    return false;
  }
  if (!installDocker()) {
    return false;
  }
  if (!installDockerCompose()) {
    return false;
  }
  if (!checkDockerAccess()) {
    return false;
  }
  if (!pullImages()) {
    return false;
  }
  var config = loadCertbotConfig();
  if (config) {
    if (confirm('Acquire SSL certificate through certbot now?', true)) {
      acquireCertbotCertificate(config);
    }
  }

  var name = getScriptName();
  console.log('');
  console.log('Installation complete');
  console.log('Run "' + name + ' start" to start Trambar');
  return true;
}

function start() {
  if (!checkDockerAccess()) {
    return false;
  }
  if (!checkConfiguration()) {
    return false;
  }
  if (!createContainers()) {
    return false;
  }
  return true;
}

function showStats() {
  if (!checkDockerAccess()) {
    return false;
  }
  var processes = getProcesses();
  if (_.isEmpty(processes)) {
    console.log('Trambar is not currently running');
    return false;
  }
  var names = _.map(processes, 'Names').sort();
  run('docker', _.concat('stats', names));
  return true;
}

function showLogs() {
  if (!checkDockerAccess()) {
    return false;
  }
  if (!isRunning()) {
    console.log('Trambar is not currently running');
    return false;
  }
  useConfigFolder();
  return run('docker-compose', [ '-p', prefix, 'logs', '-f' ]);
}

function stop() {
  if (!checkDockerAccess()) {
    return false;
  }
  if (!checkConfiguration()) {
    return false;
  }
  if (!isRunning()) {
    console.log('Trambar is not currently running');
    return false;
  }
  if (!destroyContainers()) {
    return false;
  }
  return true;
}

function restart() {
  if (!checkDockerAccess()) {
    return false;
  }
  if (!checkConfiguration()) {
    return false;
  }
  if (!isRunning()) {
    console.log('Trambar is not currently running');
    return false;
  }
  if (!restartContainers()) {
    return false;
  }
  return true;
}

function update() {
  if (!checkDockerAccess()) {
    return false;
  }
  if (!checkConfiguration()) {
    return false;
  }
  var restart = isRunning();
  if (!pullImages()) {
    return false;
  }
  if (restart) {
    if (!createContainers()) {
      return false;
    }
  }
  if (!removeUntaggedImages()) {
    return false;
  }
  return true;
}

function uninstall() {
  if (!checkRootAccess()) {
    return false;
  }
  if (isRunning()) {
    if (!destroyContainers()) {
      return false;
    }
  }
  if (!removeImages()) {
    return false;
  }
  return true;
}

function editTextFile(path) {
  var cmd = process.env.VISUAL || process.env.EDITOR || 'vi';
  var args = [ path ];
  return run(cmd, args);
}

function installDocker() {
  if (isInstalled('docker')) {
    return true;
  }
  switch (OS.type()) {
    case 'Linux':
      if (!confirm('Docker is not installed on this system. Do you want to install it?', true)) {
        return false;
      }
      if (isInstalled('apt-get')) {
        return run('apt-get -y install docker.io');
      } else if (isInstalled('pacman')) {
        return run('pacman --noconfirm -S docker')
          && run('systemctl enable docker')
          && run('systemctl start docker');
      } else if (isInstalled('yum')) {
        return run('yum -y install docker')
          && run('systemctl enable docker')
          && run('systemctl start docker');
      } else if (isInstalled('urpmi')) {
        return run('urpmi --auto docker')
          && run('systemctl enable docker')
          && run('systemctl start docker');
      }
    default:
      var url = 'https://www.docker.com/get-docker';
      console.log('You must install Docker manually (' + url + ')');
      return false;
  }
}

function installDockerCompose() {
  if (isInstalled('docker-compose')) {
    return true;
  }
  switch (OS.type()) {
    case 'Linux':
      if (!confirm('Docker Compose is not installed on this system. Do you want to install it?', true)) {
        return false;
      }
      if (isInstalled('apt-get')) {
        return run('apt-get -y install docker-compose');
      } else if (isInstalled('pacman')) {
        return run('pacman --noconfirm -S docker-compose');
      } else if (isInstalled('yum')) {
        return run('yum -y install epel-release')
          && run('yum -y install python-pip')
          && run('pip install docker-compose')
          && run('yum -y upgrade python*');
      } else if (isInstalled('urpmi')) {
        return run('urpmi --auto docker-compose');
      }
    default:
      var url = 'https://www.docker.com/get-docker';
      console.log('You must install Docker Compose manually (' + url + ')');
      return false;
  }
}

function pullImages() {
  useConfigFolder();
  if (!run('docker-compose', [ 'pull' ])) {
    return false;
  }
  return true;
}

function removeUntaggedImages() {
  var images = getImages();
  _.each(images, function(image) {
    if (image.Tag === '<none>') {
      removeImage(image.ID);
    }
  });
  return true;
}

function removeImages() {
  var images = getImages();
  return _.every(images, function(image) {
    return removeImage(image.ID);
  });
}

function createContainers() {
  var prefix = getContainerPrefix();
  useConfigFolder();
  return run('docker-compose', [ '-p', prefix, 'up', '-d' ]);
}

function destroyContainers() {
  var prefix = getContainerPrefix();
  useConfigFolder();
  return run('docker-compose', [ '-p', prefix, 'down' ]);
}

function restartContainers() {
  var prefix = getContainerPrefix();
  useConfigFolder();
  return run('docker-compose', [ '-p', prefix, 'restart' ]);
}

function confirm(question, def) {
  var prompt = attachDefault(question, def) + ' ';
  if (options.yes) {
    console.log(prompt + ' Y');
    return true;
  }
  var confirmed;
  do {
    var answer = _.trim(ReadlineSync.question(prompt));
    if (!answer) {
      confirmed = def;
    } else if (/^y/i.test(answer)) {
      confirmed = true;
    } else if (/^n/i.test(answer)) {
      confirmed = false;
    }
  } while(confirmed === undefined);
  return confirmed;
}

function promptForPassword(question, def) {
  var prompt = attachDefault(question, def) + ' ';
  if (options.yes) {
    console.log(prompt);
    return def;
  }
  var password;
  do {
    var answer = _.trim(ReadlineSync.question(prompt, { hideEchoBack: true }));
    if (!answer) {
      password = def;
    } else {
      password = answer;
    }
  } while(password === undefined);
  return password;
}

function promptForDomains(question, args) {
  var list = args;
  while (_.isEmpty(list)) {
    var text = promptForText(question);
    list = _.filter(_.split(text, /[\s,;]+/));
  }
  return list;
}

function promptForText(question, def) {
  var prompt = attachDefault(question, def) + ' ';
  var text;
  if (options.yes) {
    console.log(prompt + def);
    return def;
  }
  do {
    var answer = _.trim(ReadlineSync.question(prompt));
    if (!answer) {
      text = def;
    } else {
      text = answer;
    }
  } while(text === undefined);
  return text;
}

function promptForPath(question, def) {
  var prompt = attachDefault(question, def) + ' ';
  if (options.yes) {
    console.log(prompt);
    return def;
  }
  var path;
  do {
    var answer = _.trim(ReadlineSync.question(prompt));
    if (!answer) {
      path = def;
    } else {
      path = answer;
    }
    if (path) {
      if (!FS.existsSync(path)) {
        console.error('File not found: ' + path);
        path = undefined;
      }
    }
  } while(path === undefined);
  return path;
}

function promptForPort(question, def) {
  var prompt = attachDefault(question, def) + ' ';
  if (options.yes) {
    console.log(prompt + def);
    return def;
  }
  var port;
  do {
    var answer = _.trim(ReadlineSync.question(prompt));
    if (!answer) {
      port = def;
    } else {
      port = parseInt(answer);
      if (port !== port) {
        port = undefined;
      }
    }
  } while(port === undefined);
  return port;
}

function attachDefault(question, def) {
  switch (typeof(def)) {
    case 'boolean':
      question += (def) ? ' [Y/n]' : ' [y/N]';
      break;
    case 'number':
      question += ' [' + def + ']';
      break;
    case 'string':
      if (def) {
        question += ' [' + def + ']';
      }
      break;
  }
  return question;
}

function isRunning() {
  var processes = getProcesses();
  return !_.isEmpty(processes);
}

function checkRootAccess() {
  switch (OS.type()) {
    case 'Linux':
      if (!IsRoot()) {
        console.log('Root access required');
        return false;
      }
      return true;
    default:
      return true;

  }
}

function checkDockerAccess() {
  var cmd = 'docker ps';
  try {
    var options = {
      stdio: [ 'pipe', 'pipe', 'ignore' ]
    };
    ChildProcess.execSync(cmd, options);
    return true;
  } catch (err) {
    if (!isInstalled('docker')) {
      console.log('Docker is not installed');
    } else {
      switch (OS.type()) {
        case 'Linux':
          if (!IsRoot()) {
            console.log('Root access required');
          } else {
            console.log(err.message);
          }
          break;
        case 'Windows_NT':
        case 'Darwin':
        console.error(err);
          console.log(err.message);
          console.log('Is Docker Machine running?');
          break;
      }
    }
    return false;
  }
}

function checkConfiguration() {
  var folder = getConfigFolder();
  if (!checkFileExistence(folder + '/docker-compose.yml')) {
    return false;
  }
  if (!checkFileExistence(folder + '/.env')) {
    return false;
  }
  return true;
}

function checkFileExistence(path) {
  if (!FS.existsSync(path)) {
    console.log('File not found: ' + path);
    return false;
  }
  return true;
}

function getProcesses() {
  var prefix = getContainerPrefix();
  var regExp = new RegExp('^' + prefix + '_');
  var cmd = 'docker';
  var args = [ 'ps', '--format={ "Image": {{json .Image}}, "Names": {{json .Names}}, "ID": {{json .ID }} }' ];
  try {
    var text = ChildProcess.execFileSync(cmd, args);
    var list = parseJSONList(text);
    if (_.get(options, 'all')) {
      return list;
    } else {
      return _.filter(list, function(p) {
        if (regExp.test(p.Names)) {
          return true;
        }
      });
    }
  } catch (err) {
    console.error(err.message);
    return [];
  }
}

function getImages(options) {
  var cmd = 'docker';
  var args = [ 'images', '--format={ "Repository": {{json .Repository}}, "ID": {{json .ID }}, "Tag": {{json .Tag}} }' ];
  try {
    var text = ChildProcess.execFileSync(cmd, args);
    var list = parseJSONList(text);
    if (_.get(options, 'all')) {
      return list;
    } else {
      return _.filter(list, function(i) {
        if (/^trambar\//.test(i.Repository)) {
          return true;
        }
      });
    }
  } catch (err) {
    console.error(err.message);
    return [];
  }
}

function removeImage(id) {
  var cmd = 'docker';
  var args = [ 'rmi', id ];
  try {
    ChildProcess.execFileSync(cmd, args);
    return true;
  } catch (err) {
    console.error(err.message);
    return false;
  }
}

function createConfiguration() {
  try {
    var pub = (options.dev) ? false : isPublicServer();
    var config = {
      dev: options.dev,
      ssl: (pub) ? true : false,
      certbot: (pub) ? true : false,
      snakeoil: (pub) ? false : true,
      domains: [],
      contact_email: '',
      notification: true,
      http_port: (pub || options.dev) ? 80 : 8080,
      https_port: (pub || options.dev) ? 443 : 8443,
      cert_path: '',
      key_path: '',
      ssl_folder: '',
      source_folder: defaultSourceFolder,
      template_folder: defaultTemplateFolder,
      database_folder: getDataFolder('postgres'),
      media_folder: getDataFolder('media'),
      build: getTrambarBuild(),
      password: createRandomPasswords(6),
      root_password: defaultPassword,
      restart: (options.dev) ? 'no' : 'always',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,

      gitlab: false,
      gitlab_domains: [],
      gitlab_root_folder: '',
      gitlab_external_url: '',
      gitlab_ssh_port: 22,
      gitlab_smtp: false,
      gitlab_smtp_address: '',
      gitlab_smtp_port: 587,
      gitlab_smtp_user: '',
      gitlab_smtp_password: '',
      gitlab_smtp_domain: '',
      gitlab_smtp_email_from: '',

      wordpress: false,
      wordpress_domains: [],
      wordpress_root_folder: '',
      wordpress_data_folder: '',
    };
    if (options.dev) {
      config.source_folder = promptForText('Trambar git working folder:', config.source_folder);
      config.template_folder = promptForText('Generic template git working folder:', config.template_folder);
    }
    config.ssl = confirm('Set up SSL?', config.ssl);
    if (config.ssl) {
      config.certbot = confirm('Use certbot (https://certbot.eff.org/)?', config.certbot);
      if (config.certbot) {
        config.domains = promptForDomains('Server domain names:', config.domains);
        config.contact_email = promptForText('Contact e-mail:');
        config.notification = confirm('Receive notification e-mails from EFF?', config.notification);
        config.cert_path = getCertbotCertifcatePath(config.domains, 'fullchain.pem');
        config.key_path = getCertbotCertifcatePath(config.domains, 'privkey.pem');
        config.ssl_folder = getCertbotFolder();
        config.snakeoil = false;
      } else {
        config.snakeoil = confirm('Use self-signed SSL certificate?', config.snakeoil);
        config.domains = promptForDomains('Server domain names:', config.domains);
        if (config.snakeoil) {
          config.cert_path = getSnakeoilCertificatePath('snakeoil.crt');
          config.key_path = getSnakeoilCertificatePath('snakeoil.key');
          config.ssl_folder = getSnakeoilFolder();
        } else {
          config.cert_path = promptForPath('Full path of certificate:');
          config.key_path = promptForPath('Full path of private key:');
          config.ssl_folder = CommonDir([
            config.cert_path,
            config.key_path,
            FS.realpathSync(config.cert_path),
            FS.realpathSync(config.key_path),
          ]);
        }
        if (/^\/[^\/]+$/.test(config.ssl_folder)) {
          console.error('Certificate location requires mounting of root level folder');
          process.exit(-1);
        }
      }
      config.https_port = promptForPort('HTTPS port:', config.https_port);
    } else {
      if (config.dev) {
        config.domains = promptForDomains('Server domain names:', config.domains);
      }
    }
    config.http_port = promptForPort('HTTP port:', config.http_port);
    config.root_password = promptForPassword('Password for Trambar root account:', config.root_password);
    config.gitlab = confirm('Install GitLab?', config.gitlab);
    if (config.gitlab) {
      config.gitlab_domains = promptForDomains('GitLab domain names:', config.gitlab_domains);
      var domain = config.gitlab_domains[0];
      var protocol = (config.ssl) ? 'https' : 'http';
      var url = protocol + '://' + domain;
      if (config.ssl && config.https_port !== 443) {
        url += ':' + config.https_port;
      } else if (!config.ssl && config.http_port !== 80) {
        url += ':' + config.https_port;
      }
      config.gitlab_external_url = url;
      config.gitlab_config_folder = getDataFolder('gitlab/config');
      config.gitlab_data_folder = getDataFolder('gitlab/data');
      config.gitlab_log_folder = getDataFolder('gitlab/logs');
      config.gitlab_ssh_port = promptForPort('SSH port:', config.gitlab_ssh_port);

      config.gitlab_smtp = confirm('Set up e-mail notification?', config.gitlab_smtp);
      if (config.gitlab_smtp) {
        config.gitlab_smtp_address = promptForText('SMTP server:', config.gitlab_smtp_address);
        config.gitlab_smtp_port = promptForPort('SMTP port:', config.gitlab_smtp_port);
        config.gitlab_smtp_user = promptForText('User name:', config.gitlab_smtp_user);
        config.gitlab_smtp_password = promptForText('Password:', config.gitlab_smtp_password);
        config.gitlab_smtp_domain = promptForText('E-mail domain:', config.gitlab_smtp_domain);
        config.gitlab_smtp_email_from = promptForText('From address:', config.gitlab_smtp_email_from);
      }
    }
    config.wordpress = confirm('Install WordPress?', config.wordpress);
    if (config.wordpress) {
      config.wordpress_domains = promptForDomains('WordPress domain names:', config.wordpress_domains);
      config.wordpress_data_folder = getDataFolder('wordpress/data');
      config.wordpress_html_folder = getDataFolder('wordpress/html');
    }
    config.volumes = getVirtualVolumes();
    config.all_domains = _.union(config.domains, config.gitlab_domains, config.wordpress_domains);

    writeConfigFile('docker-compose.yml', config);
    writeConfigFile('nginx.yml', config);
    writeConfigFile('node.yml', config);
    writeConfigFile('postgres.yml', config);
    writeConfigFile('default.conf', config);
    writeConfigFile('.env', config, '0600');
    writePasswordFile('trambar.htpasswd', config.root_password);

    if (config.ssl) {
      if (config.certbot) {
        var domains = _.concat(config.domains, config.gitlab_domains, config.wordpress_domains);
        var certbot = {
          domains: domains,
          email: config.contact_email,
          notification: config.notification,
        };
        writeCertbotConfig(certbot);
      } else if (config.snakeoil) {
        writeSnakeoilCertificate('snakeoil.crt');
        writeSnakeoilCertificate('snakeoil.key');
      }
    }
    if (config.gitlab) {
      writeConfigFile('gitlab.yml', config);
      writeConfigFile('gitlab.conf', config);
    }
    if (config.wordpress) {
      writeConfigFile('wordpress.yml', config);
      writeConfigFile('wordpress.conf', config);
    }
    if (config.certbot) {
      if (cronAvailable) {
        if (confirm('Add crontab for renewing SSL certificate?', true)) {
          addRenewalCrontab();
        }
      }
    }
    if (config.dev) {
      writeConfigFile('docker-compose.override.yml', config);
    }
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

function getContainerPrefix() {
  if (options.prefix) {
    return options.prefix;
  }
  if (options.dev) {
    return 'dev';
  }
  return  defaultPrefix;
}

function getTrambarBuild() {
  return options.build || defaultBuild;
}

function getConfigFolder() {
  var folder = options.config;
  if (!folder) {
    folder = defaultConfigFolder;
    if (options.dev) {
      folder += '/dev';
    }
  }
  return folder;
}

function getSnakeoilFolder(filename) {
  return getConfigFolder() + '/certs';
}

function getSnakeoilCertificatePath(filename) {
  return getSnakeoilFolder() + '/' + filename;
}

function getCertbotFolder() {
  return '/etc/letsencrypt';
}

function getCertbotCertifcatePath(domains, filename) {
  return getCertbotFolder() + '/' + domains[0] + '/' + filename;
}

function getDataFolder(path) {
  if (virtualization) {
    var name = _.replace(path, /\//g, '_');
    if (!_.includes(virtualVolumes, name)) {
      if (!virtualVolumes) {
        virtualVolumes = [];
      }
      virtualVolumes.push(name);
    }
    return name;
  } else {
    return '/srv/trambar/' + path;
  }
}

function getVirtualVolumes() {
  return virtualVolumes;
}

function useConfigFolder() {
  var folder = getConfigFolder();
  process.chdir(folder);
}

function writeConfigFile(name, config, mode) {
  var folder = getConfigFolder();
  if (/\.conf$/.test(name)) {
    folder += '/conf.d';
  }
  var path = folder + '/' + name;
  var templateName = _.replace(name, /^\./, '');
  var templatePath = __dirname + '/templates/' + templateName;
  if (options.dev) {
    var altTemplatePath = __dirname + '/templates/dev/' + templateName;
    if (FS.existsSync(altTemplatePath)) {
      templatePath = altTemplatePath;
    }
  }
  var template = FS.readFileSync(templatePath, 'utf-8');
  try {
    var fn = _.template(template, { interpolate: /<%=([\s\S]+?)%>/g });
    var output = fn(config);
    var text = filterBlankLines(output);
  } catch (err) {
    console.error('Unable to compile template: ' + templatePath);
    throw err;
  }
  return writeFile(path, text, mode);
}

function writeSnakeoilCertificate(name, mode) {
  var path = getSnakeoilCertificatePath(name);
  var sourcePath = __dirname + '/certs/' + name;
  var text = FS.readFileSync(sourcePath, 'utf-8');
  return writeFile(path, text, mode);
}

function writePasswordFile(name, password, mode) {
  var path = getConfigFolder() + '/' + name;
  if (!password) {
    return false;
  }
  var hash = BcryptJS.hashSync(password, 10);
  // Bcrypt hash made by htpasswd has the prefix $2y$ instead of $2a$
  hash = '$2y$' + hash.substring(4);
  var text = 'root:' + hash + '\n';
  return writeFile(path, text, mode);
}

function writeFile(path, text, mode) {
  if (typeof(mode) === 'string') {
    mode = parseInt(mode, 8);
  }
  if (!mode) {
    mode = parseInt('0644', 8);
  }
  if (options.dev) {
    mode = parseInt('0666', 8);
  }
  if (FS.existsSync(path)) {
    if (!confirm('Overwrite ' + path + '?', false)) {
      return;
    }
  }
  console.log('Saving ' + path);
  var folder = Path.dirname(path);
  FS.mkdirpSync(folder);
  FS.writeFileSync(path, text);
  FS.chmodSync(path, mode);
  return true;
}

function isInstalled(program) {
  var cmd = program + ' --version';
  try {
    var options = {
      stdio: [ 'pipe', 'pipe', 'ignore' ]
    };
    ChildProcess.execSync(cmd, options);
    return true;
  } catch (err) {
    return false;
  }
}

function run(cmd, args) {
  var options = {
    stdio: [ 'inherit', 'inherit', 'inherit' ]
  };
  try {
    if (args) {
      ChildProcess.execFileSync(cmd, args, options);
    } else {
      ChildProcess.execSync(cmd, options);
    }
    return true;
  } catch (err) {
    console.error(err.message);
    return false;
  }
}

function parseJSONList(stdout) {
  var text = stdout.toString('utf-8');
  var lines = _.split(text, /[\r\n]+/);
  lines = _.filter(_.map(lines, _.trim));
  var list = _.map(lines, function(line) {
    try {
      return JSON.parse(line);
    } catch (err) {
      console.error(err.message);
      return {};
    }
  });
  return list;
}

function getVersion() {
  var json = getPackage();
  return _.get(json, 'version', 'unknown');
}

function getScriptName() {
  var json = getPackage();
  return _.get(json, 'name', 'unknown');
}

function getHostName() {
  try {
    var cmd = 'hostname';
    var options = {
      stdio: [ 'pipe', 'pipe', 'ignore' ]
    };
    var stdout = ChildProcess.execFileSync(cmd, [], options);
    return _.trim(stdout.toString('utf-8'));
  } catch (err) {
    return 'localhost';
  }
}

function getPackage() {
  var text = FS.readFileSync(__dirname + '/../package.json', 'utf-8');
  var json = JSON.parse(text);
  return json;
}

function isPublicServer() {
  var devices = OS.networkInterfaces();
  return _.some(devices, function(netIFs, name) {
    return _.some(netIFs, function(netIF) {
      if (!netIF.internal) {
        if (netIF.family === 'IPv4') {
          if (/^192\.168\./.test(netIF.address)) {
            return false;
          } else if (/^169\.254\./.test(netIF.address)) {
            return false;
          }
          return true;
        }
      }
    });
  });
}

function createRandomPasswords(count) {
  var list = [];
  for (var i = 0; i < count; i++) {
    if (options.dev) {
      list.push('qwerty');
    } else {
      list.push(Crypto.randomBytes(16).toString('hex'));
    }
  }
  return list;
}

function addDomainNames() {
  if (!checkRootAccess()) {
    return false;
  }
  var names = promptForDomains('Domains to add:', args);
  var config = loadCertbotConfig();
  if (!config) {
    config = {};
    config.email = promptForText('Contact e-mail:');
    config.notification = confirm('Receive notification e-mails from EFF?', true);
    config.domains = [];
  }
  config.domains = _.union(config.domains, names);
  writeCertbotConfig(config);
  acquireCertbotCertificate(config, true);
  return true;
}

function removeDomainNames() {
  if (!checkRootAccess()) {
    return false;
  }
  var config = loadCertbotConfig();
  if (!config) {
    return false;
  }
  var names = promptForDomains('Domains to remove:', args);
  config.domains = _.difference(config.domains, names);
  writeCertbotConfig(config);
  acquireCertbotCertificate(config, true);
  return true;
}

function requestCertificate() {
  if (!checkRootAccess()) {
    return false;
  }
  var config = loadCertbotConfig();
  if (!config) {
    return false;
  }
  acquireCertbotCertificate(config);
  return true;
}

function renewCertificate() {
  if (!checkRootAccess()) {
    return false;
  }
  renewCertbotCerts();
  return true;
}

function listDomainNames() {
  var config = loadCertbotConfig();
  if (config) {
    _.each(config.domains, function(name) {
      console.log(name);
    });
  }
}

function loadCertbotConfig() {
  try {
    var path = getConfigFolder() + '/certbot.json';
    var text = FS.readFileSync(path, 'utf8');
    return JSON.parse(text);
  } catch (err) {
  }
  return null;
}

function writeCertbotConfig(config) {
  var path = getConfigFolder() + '/certbot.json';
  var text = JSON.stringify(config, undefined, 2) + '\n';
  FS.writeFileSync(path, text);
}

function acquireCertbotCertificate(config, expand) {
  var args = [];
  args.push('certonly', '--standalone');
  args.push('--preferred-challenges', 'http');
  if (expand) {
    args.push('--expand');
  }
  _.each(config.domains, function(name) {
    args.push('-d', name);
  });
  args.push('--agree-tos');
  args.push('--email', config.email);
  if (config.notification) {
    args.push('--eff-email');
  } else {
    args.push('--no-eff-email');
  }
  return runCertbot(args);
}

function renewCertbotCerts() {
  var args = [];
  args.push('renew');
  args.push('--preferred-challenges', 'http');
  var etcFolder = getCertbotFolder();
  var mtimeBefore = getModifiedTime(etcFolder);
  if (!runCertbot(args)) {
    return false;
  }
  var mtimeAfter = getModifiedTime(etcFolder);
  if (mtimeAfter > mtimeBefore) {
    reloadNginx();
  }
  return true;
}

function runCertbot(cargs) {
  var args = [];
  args.push('run', '--rm');
  if (findNginx()) {
    var prefix = getContainerPrefix();
    args.push('--network', prefix + '_default');
  } else {
    args.push('--publish', '80:80');
  }
  args.push('--name', 'certbot');
  var etcFolder = getCertbotFolder();
  args.push('--volume', etcFolder + ':/etc/letsencrypt');
  if (!virtualization) {
    var varFolder = getDataFolder('letsencrypt');
    args.push('--volume', varFolder + ':/var/lib/letsencrypt');
  }
  args.push('certbot/certbot');

  for (var i = 0; i < cargs.length; i++) {
    args.push(cargs[i]);
  }
  return run('docker', args);
}

function findNginx() {
  var processes = getProcesses();
  var process = _.find(processes, function(process) {
    return /nginx/.test(process.Names);
  });
  if (process) {
    return process.Names;
  }
}

function reloadNginx() {
  var nginx = findNginx();
  if (!nginx) {
    return false;
  }
  var args = [];
  args.push('exec', nginx);
  args.push('service', 'nginx', 'reload');
  return run('docker', args);
}

function addRenewalCrontab() {
  var path = '/etc/cron.d/trambar-certbot-renewal';
  var args = [];
  if (options.config) {
    args.push('-c', options.config);
  }
  if (options.prefix) {
    args.push('-p', options.prefix);
  }
  if (options.dev) {
    args.push('-d');
  }
  args.push('renew');
  var cmd = 'trambar ' + args.join(' ');
  var lines = [
    'SHELL=' + process.env.SHELL,
    'PATH=' + removeHome(process.env.PATH, process.env.HOME),
    '',
    '33 3 * * * ' + cmd + ' >/dev/null 2>&1'
  ];
  var text = lines.join('\n') + '\n';
  FS.writeFileSync(path, text);
  return true;
}

function getModifiedTime(path) {
  var stat = FS.statSync(path);
  var mtime = stat.mtime;
  if (stat.isDirectory()) {
    var items = FS.readdirSync(path);
    for (var i = 0; i < items.length; i++) {
      var ipath = path + '/' + items[i];
      var itime = getModifiedTime(ipath);
      if (itime > mtime) {
        mtime = itime;
      }
    }
  }
  return mtime;
}

function filterBlankLines(text) {
  var lines = _.filter(_.split(text, '\n'), function(line) {
    return _.trim(line);
  });
  return lines.join('\n') + '\n';
}

function removeHome(path, home) {
  var folders = _.filter(_.split(path, ':'), function(folder) {
    if (_.startsWith(folder, home)) {
      return false;
    }
    return true;
  });
  return folders.join(':');
}
