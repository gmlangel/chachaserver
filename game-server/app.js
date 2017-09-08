var pomelo = require('pomelo');

/**
 * Init app for client.
 */
var app = pomelo.createApp();
app.set('name', 'chachaserver');



// app configuration
app.configure('production|development', 'connector', function(){
  app.set('connectorConfig',
    {
      connector : pomelo.connectors.hybridconnector,
      heartbeat : 3,
      useDict : true,
      useProtobuf : true
    });
});



// start app
app.start();

process.on('uncaughtException', function (err) {
  console.error(' Caught exception: ' + err.stack);
});

//自定义部分
var teaRole = {
    "canSendcmd":1
};
var stuRole = {
    "canSendcmd":0
};
var adminRole = {
    "canSendcmd":1
};
var roleMap = {
    "teaRole":teaRole,
    "stuRole":stuRole,
    "adminRole":adminRole
}
app.set("roleMap",roleMap);

//设置用户信息表
var userInfoMap = {
    "chacha":{
        "nickName":"chacha",
        "headerImage":"",
        "sex":0,
        "uid":1,
        "loginName":"chacha"
    },
    "stu1":{
        "nickName":"stu1",
        "headerImage":"",
        "sex":1,
        "uid":2,
        "loginName":"stu1"
    },
    "stu2":{
        "nickName":"stu2",
        "headerImage":"",
        "sex":1,
        "uid":3,
        "loginName":"stu2"
    },
    "stu3":{
        "nickName":"stu3",
        "headerImage":"",
        "sex":0,
        "uid":4,
        "loginName":"stu3"
    },
    "stu4":{
        "nickName":"stu4",
        "headerImage":"",
        "sex":0,
        "uid":5,
        "loginName":"stu4"
    },
    "stu5":{
        "nickName":"stu5",
        "headerImage":"",
        "sex":0,
        "uid":6,
        "loginName":"stu5"
    }
}
app.set("userInfoMap",userInfoMap);
//设置记录logined用户的数组
app.set("loginedArray",[]);

//声明uid管理函数
app.managerUserID = function(uid,sid){
    //将userID加入全局管理频道
    let channelServ = app.get('channelService');
    let channelKey = "globelC_"+uid%10;
    let channel = channelServ.getChannel(channelKey,true);
    channel.add(uid,sid);
    console.log("加入公屏",uid,sid);
    //将userID加入到用户记录数组
    app.get("loginedArray").push(uid);//将用户ID写入 已登陆数组
}

app.pushUseroffLineMSG = function(uid,reson){
    let channelServ = app.get('channelService');
    channelServ.pushMessageByUids("offlineNotify",reson,[uid]);
}

app.removeUID = function (uid){
    //移除session绑定
    let backSessionSer = app.get("backendSessionService");
    backSessionSer.get(app.getServerId(),uid,function(error,backSession){
        console.log("成功了")
        backSession.unbind(uid);
    })
    //移除uid记录
    let arr = app.get("loginedArray");
    let j = arr.length;
    for(var idx = 0;idx < j;idx++){
        if(arr[idx] == uid){
            arr.splice(idx,1);
            break;
        }
    }
}