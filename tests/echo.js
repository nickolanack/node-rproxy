/**
 * 
 */

var rproxy=require('../');

var AutoConnectProxy=rproxy.AutoConnect;
var BridgeProxy=rproxy.Bridge;
var EchoServer=rproxy.EchoServer;

var ws=require('ws');

var testNumber=0;

function EchoTest(config, callbackFn){

	var cleanup=function(){}; //reassigned
	
	var callback=function(err, msg){
		callbackFn(err, msg);
		cleanup();
		callback=function(){}; //avoid multiple executions, but don't worry about it below. 
	}
	
	
	var test=testNumber;
	testNumber++;
	console.log('Running Test: '+test);
	//a ws server that just echos back all messages...
	var echo=(new EchoServer({
		port: config.echo
	},function(){
		
		cleanup=function(){
			echo.close();
		}
		

		var basicauth='';
		basicauth='nickolanack:nick';


		var bridge=new BridgeProxy({
			port:config.bridge,
			basicauth:basicauth
		}, function(){
			
			cleanup=function(){
				echo.close();
				bridge.close();
				autoconnect.close();
			}

			if(basicauth.length){
				basicauth=basicauth+'@';
			}
			var autoconnect=new AutoConnectProxy({source:'ws://'+basicauth+'localhost:'+config.bridge, destination:'ws://localhost:'+config.echo}).on('error',function(err){
				callback(new Error('test '+test+' autoconnectproxy error'));
			});
			
			if(config.verbose){
				rproxy.util.logAutoconnectProxy(autoconnect);
				rproxy.util.logBridgeProxy(bridge);
			}

			var clients=0;

			if(typeof(config.beforeTest)=='function'){
				config.beforeTest({
					echo:echo,
					bridge:bridge,
					autoconnect:autoconnect
				});
			}
			
			

			var num=config.count;
			for(var i=0;i< num; i++){

				clients++;
				(function(i){
					var success=false;
					var client=new ws('ws://localhost:'+config.bridge);
					
					client.on('open', function(){
						setTimeout(function(){
							var tm=setTimeout(function(){
								callback(new Error('test '+test+' client#'+i+' expected response by now.'));
							}, 10000);
								client.on('message',function(message){

									if(message!=='hello world'){
										callback(new Error('test '+test+' client#'+i+' expected "hello world", recieved "'+message+'"'));	
									}else{
										
										//was logging a success message here.

									}
									
									success=true;
									clearTimeout(tm);
									this.close();
									clients--;
									if(clients==0){

										setTimeout(function(){
											callback(null); //success
											cleanup();
										},100);

									}
								});
								//console.log('test client #'+i+' sends: hello world');

								setTimeout(function(){
									client.send('hello world');
								},50+(i*25))

						}, (i*100));

					}).on('close', function(code, message){

						if(!success){
							callback(new Error('test '+test+' client#'+i+' closed before sending anything: '+code+(message?' - '+message:'')));
							
						}

					}).on('error',function(error){
						
						callback(new Error('test '+test+' client#'+i+' error: '+error));
						
					});
					
					if((typeof config.eachClient)=='function'){
						config.eachClient(client, i);
					}
					
				})(i);

			}


		});

	}));
}


module.exports=EchoTest;

