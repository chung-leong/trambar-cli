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
var defaultDatabaseFolder;
var defaultMediaFolder;
var defaultSourceFolder;

switch (OS.type()) {
    case 'Linux':
        var home = process.env.HOME;
        defaultConfigFolder = '/etc/trambar';
        defaultDatabaseFolder = '/srv/trambar/postgres';
        defaultMediaFolder = '/srv/trambar/media';
        defaultSourceFolder = home + '/trambar';
        break;
    case 'Windows_NT':
        var home = _.replace(process.env.USERPROFILE, /\\/g, '/');
        defaultConfigFolder = home + '/Trambar';
        defaultDatabaseFolder = '';
        defaultMediaFolder = '';
        break;
    case 'Darwin':
        var home = process.env.HOME;
        defaultConfigFolder = home + '/Trambar';
        defaultDatabaseFolder = '';
        defaultMediaFolder = '';
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
        name: 'debug',
        type: String,
        description: 'Start service in debugger',
        development: true,
    },
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
        header: 'Options',
        optionList: _.filter(optionDefinitions, function(def) {
            return !def.defaultOption && !def.development;
        })
    },
    {
        header: 'Certbot commands',
        content: [
            { name: 'add', summary: 'Add domain name(s)' },
            { name: 'list', summary: 'List domain names' },
            { name: 'remove', summary: 'Remove domain name(s)' },
        ]
    },
    {
        header: 'Development commands',
        content: [
            { name: 'config-dev', summary: 'Configure development server' },
            { name: 'start-dev', summary: 'Start development server' },
            { name: 'stop-dev', summary: 'Stop development server' },
        ]
    },
    {
        header: 'Development options',
        optionList: _.filter(optionDefinitions, function(def) {
            return def.development;
        })
    },
];

var options = CommandLineArgs(optionDefinitions);
var configFolder = options.config || defaultConfigFolder;
var prefix = options.prefix || defaultPrefix;
var build = options.build || defaultBuild;
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
            return addDomainName();
        case 'list':
            return listDomainNames();
        case 'remove':
            return removeDomainName();
        case 'start-dev':
            return startDev();
        case 'stop-dev':
            return stopDev();
        case 'config-dev':
            return configDev();
        default:
            console.log('Unknown command: ' + command);
            return false;
    }
}

function editCompose() {
    if (!checkRootAccess()) {
        return false;
    }
    var path = configFolder + '/docker-compose.yml';
    editTextFile(path);
}

function editEnv() {
    if (!checkRootAccess()) {
        return false;
    }
    var path = configFolder + '/.env';
    editTextFile(path);
}

function setPassword() {
    if (!checkRootAccess()) {
        return false;
    }
    if (!checkConfiguration()) {
        return false;
    }
    var password = promptForPassword('Password:');
    if (!savePassword(configFolder + '/trambar.htpasswd', password)) {
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
    console.log('');
    console.log('Installation complete');
    console.log('Run "' + getScriptName() + ' start" to start Trambar');
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
    process.chdir(configFolder);
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

function startDev() {
    if (!checkDockerAccess()) {
        return false;
    }
    if (!checkDevConfiguration()) {
        return false;
    }
    if (!createDevContainers()) {
        return false;
    }
    return true;
}

function stopDev() {
    if (!checkDockerAccess()) {
        return false;
    }
    if (!checkDevConfiguration()) {
        return false;
    }
    if (!isRunningDev()) {
        console.log('Development server is not currently running');
        return false;
    }
    if (!destroyDevContainers()) {
        return false;
    }
    return true;
}

function configDev() {
    if (!checkRootAccess()) {
        return false;
    }
    if (!createDevConfiguration()) {
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
    if (!pullDevImages()) {
        return false;
    }
    console.log('');
    console.log('Configuration complete');
    console.log('Run "' + getScriptName() + ' start-dev" to start development server');
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
    process.chdir(configFolder);
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
    process.chdir(configFolder);
    return run('docker-compose', [ '-p', prefix, 'up', '-d' ]);
}

function destroyContainers() {
    process.chdir(configFolder);
    return run('docker-compose', [ '-p', prefix, 'down' ]);
}

function restartContainers() {
    process.chdir(configFolder);
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
    if (!checkFileExistence(configFolder + '/docker-compose.yml')) {
        return false;
    }
    if (!checkFileExistence(configFolder + '/.env')) {
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

function getProcesses(regExp) {
    if (!regExp) {
        regExp = new RegExp('^' + prefix + '_');
    }
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
        var pub = isPublicServer();
        var config = {
            ssl: true,
            certbot: (pub) ? true : false,
            snakeoil: (pub) ? false : true,
            server_name: (pub) ? '' : OS.hostname(),
            contact_email: '',
            http_port: (pub) ? 80 : 8080,
            https_port: (pub) ? 443 : 8443,
            cert_path: '',
            key_path: '',
            ssl_folder: '',
            database_folder: defaultDatabaseFolder,
            media_folder: defaultMediaFolder,
            volumes: !defaultDatabaseFolder || !defaultMediaFolder,
            build: build,
            password: _.map([ 1, 2, 3, 4], function() {
                return Crypto.randomBytes(16).toString('hex');
            }),
        };
        config.ssl = confirm('Set up SSL?', config.ssl);
        if (config.ssl) {
            config.certbot = confirm('Use certbot (https://certbot.eff.org/)?', config.certbot);
            if (config.certbot) {
                config.server_name = promptForText('Server domain name:', config.server_name);
                config.contact_email = promptForText('Contact e-mail:');
                config.ssl_folder = './certbot';
                config.snakeoil = false;
            } else {
                config.snakeoil = confirm('Use self-signed SSL certificate?', config.snakeoil);
                config.server_name = promptForText('Server domain name:', config.server_name);
                if (config.snakeoil) {
                    config.ssl_folder = configFolder + '/certs';
                    config.cert_path = config.ssl_folder + '/snakeoil.crt';
                    config.key_path = config.ssl_folder + '/snakeoil.key';
                } else {
                    config.cert_path = promptForPath('Full path of certificate:');
                    config.key_path = promptForPath('Full path of private key:');
                    config.ssl_folder = CommonDir([
                        config.cert_path,
                        config.key_path,
                        FS.realpathSync(config.cert_path),
                        FS.realpathSync(config.key_path),
                    ]);
                    if (/^\/[^\/]+$/.test(config.ssl_folder)) {
                        console.error('Certificate location requires mounting of root level folder');
                        process.exit(-1);
                    }
                }
            }
            config.https_port = promptForPort('HTTPS port:', config.https_port);
        }
        config.http_port = promptForPort('HTTP port:', config.http_port);
        var password = promptForPassword('Password for Trambar root account:', defaultPassword);

        if (config.snakeoil) {
            createConfigFile(config.cert_path, 'snakeoil.crt', {});
            createConfigFile(config.key_path, 'snakeoil.key', {});
        }
        createConfigFile(configFolder + '/docker-compose.yml', 'docker-compose.yml', config);
        createConfigFile(configFolder + '/nginx.yml', 'nginx.yml', config);
        createConfigFile(configFolder + '/node.yml', 'node.yml', config);
        createConfigFile(configFolder + '/postgres.yml', 'postgres.yml', config);
        createConfigFile(configFolder + '/.env', 'env', config, '0600');
        savePassword(configFolder + '/trambar.htpasswd', password);
        return true;
    } catch (err) {
        console.error(err.message);
        return false;
    }
}

function createConfigFile(path, name, config, mode) {
    if (typeof(mode) === 'string') {
        mode = parseInt(mode, 8);
    }
    if (FS.existsSync(path)) {
        if (!confirm('Overwrite ' + path + '?', false)) {
            return;
        }
    }
    var folder = Path.dirname(path);
    FS.mkdirpSync(folder);
    var templatePath = __dirname + '/templates/' + name;
    var template = FS.readFileSync(templatePath, 'utf-8');
    var fn = _.template(template, { interpolate: /<%=([\s\S]+?)%>/g });
    var text = fn(config);

    console.log('Saving ' + path);
    FS.writeFileSync(path, text);
    if (mode) {
        FS.chmodSync(path, mode);
    }
}

function savePassword(path, password) {
    if (!password) {
        return false;
    }
    var hash = BcryptJS.hashSync(password, 10);
    // Bcrypt hash made by htpasswd has the prefix $2y$ instead of $2a$
    hash = '$2y$' + hash.substring(4);
    var text = 'root:' + hash + '\n';
    if (FS.existsSync(path)) {
        if (!confirm('Overwrite' + path + '?', false)) {
            return;
        }
    }
    console.log('Saving ' + path);
    FS.writeFileSync(path, text);
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

function addDomainName() {
    if (!checkRootAccess()) {
        return false;
    }
    var names;
    if (_.isEmpty(args)) {
        var text = promptForText('Domain(s) to add:');
        names = _.filter(_.split(text, /[\s,;]+/));
    } else {
        names = args;
    }
    if (_.isEmpty(names)) {
        return false;
    }
    var config = loadCertbotConfig();
    if (!config) {
        config = {};
        config.email = promptForText('Contact e-mail:');
        config.notification = confirm('Receive notification e-mails from EFF?', true);
        config.domains = [];
    }
    config.domains = _.union(config.domains, names);
    saveCertbotConfig(config);
    requestCertbotCerts(config);
    return true;
}

function removeDomainName() {
    if (!checkRootAccess()) {
        return false;
    }
    var config = loadCertbotConfig();
    if (!config) {
        return false;
    }
    var names;
    if (_.isEmpty(args)) {
        var text = promptForText('Domain(s) to remove:');
        names = _.filter(_.split(text, /[\s,;]+/));
    } else {
        names = args;
    }
    if (_.isEmpty(names)) {
        return false;
    }
    config.domains = _.difference(config.domains, names);
    saveCertbotConfig(config);
    requestCertbotCerts(config);
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
    var path = configFolder + '/certbot.json';
    try {
        var text = FS.readFileSync(path, 'utf8');
        return JSON.parse(text);
    } catch (err) {
    }
    return null;
}

function saveCertbotConfig(config) {
    var path = configFolder + '/certbot.json';
    var text = JSON.stringify(config, undefined, 2) + '\n';
    FS.writeFileSync(path, text);
}

function requestCertbotCerts(config) {
    var args = [];
    // docker arguments
    args.push('run', '--rm');
    if (findNginx()) {
        args.push('--network', prefix + '_default');
    } else {
        args.push('--expose', 80);
    }
    args.push('--name', 'certbot');
    args.push('certbot/certbot');

    // certbot command
    args.push('certonly', '--standalone');
    args.push('--preferred-challenges', 'http');
    config.domains.each(function(name) {
        args.push('-d', name);
    });
    args.push('--agree-tos');
    args.push('--email', config.email);
    if (config.notification) {
        args.push('--eff-email');
    } else {
        args.push('--no-eff-email');
    }
    return run('docker', args);
}

function findNginx() {
    var processes = getProcesses();
    return _.some(processes, function(process) {
        return /^nginx/.test(process.Image);
    });
}

function checkDevConfiguration() {
    if (!checkFileExistence(configFolder + '/dev/docker-compose.yml')) {
        return false;
    }
    if (!checkFileExistence(configFolder + '/dev/.env')) {
        return false;
    }
    return true;
}

function createDevConfiguration() {
    try {
        var config = {
            ssl: true,
            certbot: false,
            snakeoil: true,
            server_name: 'localhost',
            contact_email: '',
            http_port: 80,
            https_port: 443,
            cert_path: '',
            key_path: '',
            ssl_folder: '',
            database_folder: defaultDatabaseFolder,
            media_folder: defaultMediaFolder,
            source_folder: defaultSourceFolder,
            volumes: !defaultDatabaseFolder || !defaultMediaFolder,
            build: build,
            password: _.map([ 1, 2, 3, 4], function() {
                return 'qwerty';
            }),
        };
        config.source_folder = promptForText('Trambar git working folder:', config.source_folder);
        var password = promptForPassword('Password for Trambar root account:', defaultPassword);
        if (config.snakeoil) {
            config.ssl_folder = configFolder + '/dev/certs';
            config.cert_path = config.ssl_folder + '/snakeoil.crt';
            config.key_path = config.ssl_folder + '/snakeoil.key';
            createConfigFile(config.cert_path, 'snakeoil.crt', {});
            createConfigFile(config.key_path, 'snakeoil.key', {});
        }
        createConfigFile(configFolder + '/dev/docker-compose.yml', 'dev/docker-compose.yml', config);
        createConfigFile(configFolder + '/dev/nginx.yml', 'nginx.yml', config);
        createConfigFile(configFolder + '/dev/node.yml', 'dev/node.yml', config);
        createConfigFile(configFolder + '/dev/postgres.yml', 'postgres.yml', config);
        createConfigFile(configFolder + '/dev/.env', '/dev/env', config, '0600');
        createConfigFile(configFolder + '/dev/conf.d/default.conf', 'default.conf', config);
        savePassword(configFolder + '/dev/trambar.htpasswd', password);
        return true;
    } catch (err) {
        console.error(err.message);
        return false;
    }
}

function isRunningDev() {
    var processes = getProcesses(/^dev_/);
    return !_.isEmpty(processes);
}

function pullDevImages() {
    process.chdir(configFolder + '/dev');
    if (!run('docker-compose', [ 'pull' ])) {
        return false;
    }
    return true;
}

function createDevContainers() {
    process.chdir(configFolder + '/dev');
    return run('docker-compose', [ '-p', 'dev', 'up', '-d' ]);
}

function destroyDevContainers() {
    process.chdir(configFolder + '/dev');
    return run('docker-compose', [ '-p', 'dev', 'down' ]);
}
