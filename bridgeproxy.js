/**
 * Bridge proxy
 * 
 */



var events = require('events');

/**
 * config options:{
 * 		port:int //only processes with root permissions can listen on privileged ports, ie: sudo node bridgeproxy.js
 * }
 */
function WSBridgeProxy(config, callback) {

	// Simple websocket server
	var me = this;
	events.EventEmitter.call(me);

	var freeServerConnections = {
		'/': []
	};
	var freeClientConnections = {
		'/': []
	};


	if (config.server) {

		me.server = (new(require('ws').Server)({
			server: config.server
		}, function() {

			console.log('bridgeproxy websocket listening on: ' + config.port);

			if ((typeof callback) == 'function') {
				callback();
			}
		}));

		if (config.server && config.port) {
			config.server.listen(config.port, callback);
		}

	} else if (config.port) {

		me.server = (new(require('ws').Server)({
			port: config.port
		}, function() {

			console.log('bridgeproxy websocket listening on: ' + config.port);

			if ((typeof callback) == 'function') {
				callback();
			}
		}));


	} else {
		throw new Error('Expected server or port, in config');
	}


	var domains = [];
	var getDomain = function(ws) {

		var domain = ws.upgradeReq.url.toLowerCase();
		if (!domain) {
			domain = '/';
		}

		if (domains.indexOf(domain) < 0) {
			domains.push(domain);
			freeServerConnections[domain] = [];
			freeClientConnections[domain] = [];
		}

		return domain;

	}


	me.server.on('connection', function(wsclient) {

		var domain = getDomain(wsclient);


		if (me._isSocketAttemptingAuth(wsclient)) {

			if (me._authorizeSocketAsServerConnection(wsclient, config.basicauth)) {
				freeServerConnections[domain].push(wsclient)
				me.emit('server.connect', wsclient);

				var handleServerEarlyDisconnect = function() {
					var i = freeServerConnections[domain].indexOf(wsclient)
					if (i >= 0) {
						freeServerConnections[domain].splice(i, 1);
						console.log('server closed early: ' + JSON.stringify(arguments));
						me.emit('server.close', wsclient);
					}
				};

				wsclient.on('close', handleServerEarlyDisconnect).on('error', handleServerEarlyDisconnect);


			} else {
				console.log('drop server connection, failed basicauth');
				wsclient.close(3000, 'bridge basic auth attempt invalid');
				return;
			}
		} else {

			freeClientConnections[domain].push(wsclient);
			me.emit('client.connect', wsclient);
			me._bufferSocket(wsclient);


			var handleClientEarlyDisconnect = function() {
				var i = freeClientConnections[domain].indexOf(wsclient)
				if (i >= 0) {
					freeClientConnections[domain].splice(i, 1);
					console.log('client closed early');
					me.emit('client.close', wsclient);
				}

			};

			wsclient.on('close', handleClientEarlyDisconnect).on('error', handleClientEarlyDisconnect);


		}



		while (freeServerConnections[domain].length && freeClientConnections[domain].length) {

			var server = freeServerConnections[domain].shift();
			var client = freeClientConnections[domain].shift();
			me._connectSockets(server, client);

		}



	}).on('close', function() {

		console.log('bridge server closed');

	}).on('error', function(err) {
		throw err;
	});



};

WSBridgeProxy.prototype.__proto__ = events.EventEmitter.prototype;



WSBridgeProxy.prototype._bufferSocket = function(wsclient) {
	var me = this;
	if (!me._flushBuffers) {


		me._bufferedClients = [];
		me._buffers = [];
		me._handlers = [];


		me._flushBuffers = function(server, client) {
			var i = me._bufferedClients.indexOf(client);
			if (me._buffers[i].length) {

				me.emit('buffer.flush', wsclient, buffer);

				me._buffers[i].forEach(function(message) {
					//client.emit('message', message);
					try {
						console.log('send to server buffered: ' + message);
						server.send(message);
					} catch (e) {
						console.log('client flush buffer error: ' + e.message);
					}
				});

				me.emit('buffer.close', wsclient);
			}

			me._bufferedClients.splice(i, 1);
			me._buffers.splice(i, 1);
			client.removeListener('message', me._handlers[i]);
			me._handlers.splice(i, 1);
		}

		me.on('pair', me._flushBuffers);
	}


	me._bufferedClients.push(wsclient);
	var buffer = [];
	me._buffers.push(buffer);
	var handler = function message(data, flags) {

		if (buffer.length == 0) {
			me.emit('buffer.create', wsclient);
		}

		buffer.push(data);
		me.emit('buffer', wsclient, data);
	}
	me._handlers.push(handler);
	wsclient.on('message', handler);

};

WSBridgeProxy.prototype._isSocketAttemptingAuth = function(wsclient) {
	return (typeof wsclient.upgradeReq.headers.authorization) != 'undefined'
};

WSBridgeProxy.prototype._authorizeSocketAsServerConnection = function(wsclient, basicauth) {
	var atob = require('atob');
	var b64auth = wsclient.upgradeReq.headers.authorization.split(' ')[1];
	var auth = atob(b64auth);
	if (auth === basicauth) {
		return true;
	} else {
		console.log('bridge basic auth attempt invalid: ' + b64auth + ' = ' + auth + ' | ' + basicauth)
		return false;
	}
};

WSBridgeProxy.prototype._connectSockets = function(wsserver, wsclient) {

	var me = this;
	var server = wsserver;
	var client = wsclient;

	var cleanup = function() {
		if (client && server) {
			me.emit('unpair', server, client);
		}
		if (client) {
			client = null;
			wsclient.close();

		}
		if (server) {
			server = null;
			wsserver.close();
		}


	}

	server.on('message', function() {
		try {
			client.send.apply(client, arguments);
		} catch (e) {
			console.log('send to client error: ' + e.message);
			//cleanup();
		}
	}).on('close', cleanup).on('error', cleanup);
	client.on('message', function() {
		try {
			server.send.apply(server, arguments);
		} catch (e) {
			console.log('send to server error: ' + e.message);
			//cleanup();
		}
	}).on('close', cleanup).on('error', cleanup);



	server.send('CLIENT CONNECT');
	console.log('Connected Client');

	//will cause client buffered data to be sent.
	me.emit('pair', server, client);



}

WSBridgeProxy.prototype.close = function() {

	var me = this;
	me.server.close();

}

module.exports = WSBridgeProxy;

/**
 * can be run directly from the command line. ie: sudo node bridgeproxy.js port username:password
 */

if (process.argv) {
	if (!process.argc) {
		process.argc = process.argv.length;
	}


	var fs = require('fs');
	fs.realpath(process.argv[1], function(err, p1) {

		fs.realpath(__filename, function(err, p2) {

			//console.log(p1+' '+p2);

			if (p1 === p2) {

				console.log(process.argv);

				if (process.argc >= 3) {
					var opt = {
						port: parseInt(process.argv[2])
					};
					if (process.argc > 3) {
						opt.basicauth = process.argv[3];
					}
					new WSBridgeProxy(opt);
				} else {
					new WSBridgeProxy(require('./bridgeproxy.json'));
				}


			}

		});
	});
}