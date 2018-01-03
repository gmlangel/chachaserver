var WebSocketServer = require('ws').Server
var wss = new WebSocketServer({ port: 31111,host:"172.16.221.198"});
wss.on('connection', function (ws) {
    console.log('client connected');
    ws.on('message', function (message) {
        console.log(message);
        ws.send("OK你很棒")
    });
    ws.on('close',function(evt){
    	console.log("断开");
    })
    ws.on('error',function(evt){
    	console.log("发生错误")
    })
});