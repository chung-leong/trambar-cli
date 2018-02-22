#!/usr/bin/env node

var _ = require('lodash');
var FS = require('fs');
var Path = require('path');
var ChildProcess = require('child_process');
var CommandLineArgs = require('command-line-args');
var CommandLineUsage = require('command-line-usage');
var ReadlineSync = require('readline-sync');
var IsRoot = require('is-root');

var configFolder = `/etc/trambar`;

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
        description: `Specify config directory (default: /etc/trambar)`
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
        description: `Specifu Docker container prefix (default: trambar)`
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
            { name: 'password', summary: 'Set password of root account' },
            { name: 'install', summary: 'Download Docker images and create default configuration' },
            { name: 'start', summary: 'Start Trambar' },
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

try {
    var options = CommandLineArgs(optionDefinitions);
    var command = _.get(options, [ '*', 0 ]);
    switch (_.toLower(command)) {
        case 'compose':
            editCompose();
            break;
        case 'env':
            editEnv();
            break;
        case 'password':
            setPassword();
            break;
        case 'install':
            install();
            break;
        case 'start':
            start();
            break;
        case 'stop':
            stop();
            break;
        case 'update':
            update();
            break;
        case 'uninstall':
            uninstall();
            break;
        default:
            if (command) {
                console.log(`Unknown command: ${command}`);
            }
    }

    if (!command) {
        if (options.version) {
            var version = getVersion();
            console.log(version);
        } if (options.help) {
            var usage = CommandLineUsage(scriptDescription);
            console.log(usage);
        }
        process.exit(0);
    }
} catch(err) {
    console.log(err.message);
    process.exit(-1);
}

function editCompose() {
    var path = `${configFolder}/docker-compose.yml`;
    editTextFile(path);
}

function editEnv() {
    var path = `${configFolder}/.env`;
    editTextFile(path);
}

function setPassword() {
    console.log('set password');
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
    return true;
}

function start() {
    if (!checkDockerAccess()) {
        return false;
    }
    if (!gotoConfigFolder()) {
        return false;
    }
    if (!createContainers()) {
        return false;
    }
    return true;
}

function stop() {
    if (!checkDockerAccess()) {
        return false;
    }
    if (!checkConfiguration()) {
        return false;
    }
    if (!destroyContainers()) {
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
    if (!FS.existsSync(path)) {
        console.warn(`File not found: ${path}`);
        return false;
    }
    try {
        FS.accessSync(folder, FS.constants.W_OK);
    } catch (err) {
        console.warn(`No write access: ${path}`);
        return false
    }
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
        run('apt-get -y install docker.io');
    } else if (isInstalled('pacman')) {
        run('pacman --noconfirm -S docker');
    } else if (isInstalled('yum')) {

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
        run('apt-get -y install docker-compose');
    } else if (isInstalled('pacman')) {
        run('pacman --noconfirm -S docker-compose');
    } else if (isInstalled('yum')) {

    }
}

function pullImages() {
    var imagesBefore = getImages();
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
}

function removeImages() {
    var images = getImages();
    return _.every(images, (image) => {
        return removeImage(image.ID);
    });
}

function createContainers() {
    return run('docker-compose', [ '-p', 'trambar', 'up', '-d' ]);
}

function destroyContainers() {
    return run('docker-compose', [ '-p', 'trambar', 'down' ]);
}

function confirm(question, def) {
    var confirmed;
    if (def === undefined) {
        def = true;
    }
    if (options.yes) {
        console.log(question + '\n');
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
        ChildProcess.execSync(cmd);
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

}

function getProcesses(options) {
    var cmd = 'docker';
    var args = [ 'ps', '--format="{{json .}}"' ];
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
    var args = [ 'images', '--format="{ "Repository": {{json .Repository}}, "ID": {{json .ID }} }"' ];
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

function isInstalled(program) {
    var cmd = `${program} -v`;
    try {
        ChildProcess.execSync(cmd);
        return true;
    } catch (err) {
        return false;
    }
}

function run(cmd, args) {
    var options = {
        stdio: [ 'inherit', 'inherit', 'inherit' ]
    };
    if (args) {
        ChildProcess.execFileSync(cmd, args, options);
    } else {
        ChildProcess.execSync(cmd, options);
    }
}

function parseJSONList(text) {
    var lines = _.split(text, /[\r\n]+/);
    var list = _.map(lines, (line) => {
        return JSON.parse(line);
    });
    return list;
}
