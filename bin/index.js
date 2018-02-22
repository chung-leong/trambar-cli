#!/usr/bin/env node

var _ = require('lodash');
var FS = require('fs'); FS.mkdirpSync = require('mkdirp').sync;
var Path = require('path');
var ChildProcess = require('child_process');
var Crypto = require('crypto');
var BcryptJS = require('bcryptjs');
var CommandLineArgs = require('command-line-args');
var CommandLineUsage = require('command-line-usage');
var ReadlineSync = require('readline-sync');
var IsRoot = require('is-root');

var defaultConfigFolder = '/etc/trambar';
var defaultPrefix = 'trambar';
var defaultPassword = 'password';

var optionDefinitions = [
    {
        name: '*',
        type: String,
        multiple: true,
        defaultOption: true,
    },
    {
        name: 'config',
        alias: 'c',
        type: String,
        description: `Specify config directory (default: ${defaultConfigFolder})`
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
        description: `Specify Docker container prefix (default: ${defaultPrefix})`
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
        header: 'Command List',
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
        optionList: _.filter(optionDefinitions, (def) => {
            return !def.defaultOption;
        })
    }
];

var options = CommandLineArgs(optionDefinitions);
var configFolder = options.config || defaultConfigFolder;
var prefix = options.prefix || defaultPrefix;
var command = _.get(options, [ '*', 0 ]);
if (command) {
    if (!runCommand(command)) {
        process.exit(-1);
    }
} else {
    if (options.version) {
        var version = getVersion();
        console.log(`Trambar version ${version}`);
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
        default:
            console.log(`Unknown command: ${command}`);
            return false;
    }
}

function editCompose() {
    if (!checkRootAccess()) {
        return false;
    }
    var path = `${configFolder}/docker-compose.yml`;
    editTextFile(path);
}

function editEnv() {
    if (!checkRootAccess()) {
        return false;
    }
    var path = `${configFolder}/.env`;
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
    if (!savePassword(password)) {
        return false;
    }
    return true;
}

function install() {
    if (!checkRootAccess()) {
        return false;
    }
    if (!installDocker()) {
        return false;
    }
    if (!installDockerCompose()) {
        return false;
    }
    if (!createDefaultConfiguration()) {
        return false;
    }
    if (!pullImages()) {
        return false;
    }
    console.log('');
    console.log(`Installation complete`);
    console.log(`Run "${getScriptName()} start" to start Trambar`);
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
    return run('docker-compose', [ '-p', prefix, 'logs' ]);
    return true;
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
    if (!pullImages()) {
        return false;
    }
    if (isRunning()) {
        if (!createContainers()) {
            return false;
        }
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
    if (!destroyConfiguration()) {
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
    if (!confirm('Docker is not installed on this system. Do you want to install it? [Y/n]')) {
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
    } else {
        console.log('Unable to find suitable package manager');
        return false;
    }
}

function installDockerCompose() {
    if (isInstalled('docker-compose')) {
        return true;
    }
    if (!confirm('Docker Compose is not installed on this system. Do you want to install it? [Y/n]')) {
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
    } else {
        console.log('Unable to find suitable package manager');
        return false;
    }
}

function pullImages() {
    var imagesBefore = getImages();
    process.chdir(configFolder);
    if (!run('docker-compose', [ 'pull' ])) {
        return false;
    }
    var imagesAfter = getImages({ all: true });
    _.each(imagesBefore, (before) => {
        var after = _.find(imagesAfter, { ID: before.ID });
        if (after) {
            if (!after.Repository) {
                removeImage(before.ID);
            }
        }
    });
    return true;
}

function removeImages() {
    var images = getImages();
    return _.every(images, (image) => {
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
    var confirmed;
    if (def === undefined) {
        def = true;
    }
    if (options.yes) {
        console.log(question);
        return true;
    }
    do {
        var answer = _.trim(ReadlineSync.question(question + ' '));
        if (!answer) {
            confirmed = def;
        } else if (/^y/i.test(answer)) {
            confirmed = true;
        } else if (/^n/i.test(answer)) {
            confirmed = false;
        }
    } while(confirmed === undefined)
    return confirmed;
}

function promptForPassword(question, def) {
    var password;
    if (options.yes) {
        console.log(question);
        return def;
    }
    do {
        var answer = _.trim(ReadlineSync.question(question + ' ', { hideEchoBack: true }));
        if (!answer) {
            password = def;
        } else {
            password = answer;
        }
    } while(password === undefined)
    return password;
}

function isRunning() {
    var processes = getProcesses();
    return !_.isEmpty(processes);
}

function checkRootAccess() {
    if (!IsRoot()) {
        console.log('Root access required');
        return false;
    }
    return true;
}

function checkDockerAccess() {
    var cmd = `docker ps`;
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
            console.log('Root access required');
        }
        return false;
    }
}

function checkConfiguration() {
    if (!checkFileExistence(`${configFolder}/docker-compose.yml`)) {
        return false;
    }
    if (!checkFileExistence(`${configFolder}/.env`)) {
        return false;
    }
    return true;
}

function checkFileExistence(path) {
    if (!FS.existsSync(path)) {
        console.log(`File not found: ${path}`);
        return false;
    }
    return true;
}

function getProcesses(options) {
    var cmd = 'docker';
    var args = [ 'ps', '--format={ "Image": {{json .Image}}, "Names": {{json .Names}}, "ID": {{json .ID }} }' ];
    try {
        var text = ChildProcess.execFileSync(cmd, args);
        var list = parseJSONList(text);
        if (_.get(options, 'all')) {
            return list;
        } else {
            return _.filter(list, (p) => {
                if (/^trambar\//.test(p.Image)) {
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
    var args = [ 'images', '--format={ "Repository": {{json .Repository}}, "ID": {{json .ID }} }' ];
    try {
        var text = ChildProcess.execFileSync(cmd, args);
        var list = parseJSONList(text);
        if (_.get(options, 'all')) {
            return list;
        } else {
            return _.filter(list, (i) => {
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

function createDefaultConfiguration() {
    try {
        FS.mkdirpSync(configFolder);
        var dockerCompseYML = FS.readFileSync(`${__dirname}/docker-compose.yml`, 'utf-8');
        var envTemplate = FS.readFileSync(`${__dirname}/env-template`, 'utf-8');
        var envFunc = _.template(envTemplate);
        var password = _.map([ 1, 2, 3, 4], () => {
            return Crypto.randomBytes(16).toString('hex');
        });
        var env = envFunc({ password });
        FS.writeFileSync(`${configFolder}/docker-compose.yml`, dockerCompseYML);
        FS.writeFileSync(`${configFolder}/.env`, env);
        FS.chmodSync(`${configFolder}/.env`, 0600);
        var password = promptForPassword(`Password for Trambar root account [${defaultPassword}]:`, defaultPassword);
        savePassword(password);
        return true;
    } catch (err) {
        console.error(err.message);
        return false;
    }
}

function destroyConfiguration() {
    try {
        FS.unlinkSync(`${configFolder}/docker-compose.yml`);
        FS.unlinkSync(`${configFolder}/.env`);
        FS.unlinkSync(`${configFolder}/trambar.htpasswd`);
        try {
            FS.rmdirSync(configFolder);
        } catch (err) {
        }
        return true;
    } catch (err) {
        console.error(err.message);
        return false;
    }
}

function savePassword(password) {
    if (!password) {
        return false;
    }
    var hash = BcryptJS.hashSync(password, 10);
    // Bcrypt hash made by htpasswd has the prefix $2y$ instead of $2a$
    hash = '$2y$' + hash.substring(4);
    var text = `root:${hash}\n`;
    FS.writeFileSync(`${configFolder}/trambar.htpasswd`, text);
    return true;
}

function isInstalled(program) {
    var cmd = `${program} --version`;
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
    var list = _.map(lines, (line) => {
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

function getPackage() {
    var text = FS.readFileSync(`${__dirname}/../package.json`, 'utf-8');
    var json = JSON.parse(text);
    return json;
}
