/**
 * Created by guominglong on 2017/9/7.
 */
//class导入---------------------------------
var GMLServerClass = require("./GMLServer.js");
var netClass = require("net");

//对象以及属性声明------------------------------------
var mainServer = null;//主服务器
var mainServerPort = 49999;
var connectIdOffset = 0;//客户端连接的ID ,用于生成 '客户端连接ID池';
var connectIdPool = [];//客户端连接ID池
var unOwnedConnect = {};//无主连接字典.用于记录未经登陆的用户的socket链接 {sid:socket}
var ownedConnect = {};//有主连接字典{sid:socket}
var ownedConnectUIDMap = {};//有主连接字典{uid:socket}
var execFuncMap = {};//数据包处理函数的字典


//函数声明-----------------------------------------
//主函数
function start(){
    mainServer = netClass.createServer(function (newConnectIns){
       // console.log(console.log(process.memoryUsage()));
        newConnectIns.sid = createConnectId();//为socket链接设置ID;
        console.log("新链接接入,socAddress:"+newConnectIns.remoteAddress + " socPort:" + newConnectIns.remotePort," sid:" + newConnectIns.sid)
        newConnectIns.uid = -1;//为其设置一个默认的uid
        newConnectIns.setTimeout(10000);//设置socket超时时间为60秒
        //将socket加入到无主链接字典中
        unOwnedConnect[newConnectIns.sid.toString()] = newConnectIns;
        //添加相关事件
        newConnectIns.on("data",function(dataBuffer){
            //解析数据包remote
            analyzeDataPackage(this.sid,dataBuffer);
        })

        newConnectIns.on("end",function(){
            console.log(this.sid,this.remotePort, "断开了链接")
            destroySocket(this);
        })

        newConnectIns.on("error",function(err){
            //客户端为正常断开socket也会触发这里,而不触发 end事件
            console.log("socket出错断开");
            destroySocket(this);
            this.destroy();
        })

        newConnectIns.on("timeout",function(){
            this.end("socket超时");
        })

        newConnectIns.write('欢迎加入茶茶服务器');
    });
    mainServer.listen(mainServerPort,function(){
        console.log('服务器启动成功')
    })
}

/**
 * 生成一个客户端ID
 * return id int
 * */
function createConnectId(){
    if(connectIdPool.length == 0){
        //填充ID池,每次填充10000个,已connectIdOffset作为游标, ID的最大限制为0xfffffffffffffe
        if(connectIdOffset < 0xfffffffffffffe - 10000){
            for(var i = 1;i<=10000;i++){
                connectIdPool.push(connectIdOffset + i);
            }
            connectIdOffset += 10000;
        }else{
            throw Error("无法继续生成connectId,因为ID超出最大限制")
            return 0;
        }
    }
    return connectIdPool.pop();
}

/**
 * 解析数据包,并分发给指定的处理器
 * @param sid int socketID
 * @param dataBuffer Buffer
 * */
function analyzeDataPackage(sid,dataBuffer){
    try{

        var dataStr = dataBuffer.toString();
        var obj = JSON.parse(dataStr);
        var cmd = obj["cmd"] || 0;
        cmd = parseInt(cmd);
        console.log("收到数据包",cmd.toString(16))
        //如果存在处理函数,则进行处理
        if(execFuncMap.hasOwnProperty(cmd) && typeof(execFuncMap[cmd]) == 'function'){
            execFuncMap[cmd](sid,obj);
        }
    }catch(err){
        console.log(err);
        console.log("数据包不是JSON字符串",dataStr);
    }
}

/**
 * 停止socket链接
 * @param soc socket链接
 * @param reason string 原因
 * */
function destroySocket(soc){
    var sidKey = soc.sid.toString();
    var uidKey = soc.uid.toString();
    var sid = soc.sid;
    try{
        if(unOwnedConnect.hasOwnProperty(sidKey)){
            unOwnedConnect[sidKey] = null;
            delete unOwnedConnect[sidKey];
        }

        if(ownedConnect.hasOwnProperty(sidKey)){
            ownedConnect[sidKey] = null;
            delete ownedConnect[sidKey];
        }

        if(ownedConnectUIDMap.hasOwnProperty(uidKey)){
            ownedConnectUIDMap[uidKey] = null;
            delete ownedConnectUIDMap[uidKey];
        }
        //返回socketID 到id池,以便之后的链接使用
        connectIdPool.push(sid);
    }catch(err){
        console.log("socket:"+soc.sid + "停止失败");
    }


}

//心跳服务
execFuncMap[0x00FF0001] = function(sid,dataObj){
    var seq = dataObj["seq"] || 0;
    var lt = dataObj["lt"] || 0;
    var sidKey = sid.toString();
    var sock = null;
    if(unOwnedConnect.hasOwnProperty(sidKey)){
        sock = unOwnedConnect[sidKey];
    }else if(ownedConnect.hasOwnProperty(sidKey)){
        sock = ownedConnect[sidKey];
    }else if(ownedConnectUIDMap.hasOwnProperty(sidKey)){
        sock = ownedConnectUIDMap[sidKey];
    }
    //心跳服务 s_to_c
    if(sock){
        sock.write(JSON.stringify({cmd:0x00FF0002,seq:seq + 1,c_seq:seq,st:parseInt(new Date().valueOf() / 1000)}));
    }
}

//
//主入口逻辑部分--------------------------------
if(require.main === module){
    start();
}