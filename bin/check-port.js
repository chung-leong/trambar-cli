#!/usr/bin/env node

var HTTP = require('http');

var port = parseInt(process.argv[2]);
var server = new HTTP.Server;
server.listen(port, (err) => {
    if (!err) {
        console.log('open');
        server.close();
        process.exit(0);
    } else {
        console.log('busy');
        process.exit(-1);
    }
});
