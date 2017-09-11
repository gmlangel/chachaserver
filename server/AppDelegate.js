/**
 * Created by guominglong on 2017/9/7.
 */
//class导入----------------------------------------------------------------------------------------------------------
var netClass = require("net");
var crypto = require('crypto');

//对象以及属性声明----------------------------------------------------------------------------------------------------------
var mainServer = null;//主服务器
var mainServerPort = 49999;
var connectIdOffset = 0;//客户端连接的ID ,用于生成 '客户端连接ID池';
var connectIdPool = [];//客户端连接ID池
var unOwnedConnect = {};//无主连接字典.用于记录未经登陆的用户的socket链接 {sid:socket}
var ownedConnect = {};//有主连接字典{sid:socket}
var ownedConnectUIDMap = {};//有主连接字典{uid:socket}
var execFuncMap = {};//数据包处理函数的字典

//老师权限
var teaRole = {
    "canSendcmd":1
};
//学生权限
var stuRole = {
    "canSendcmd":0
};
//管理员权限
var adminRole = {
    "canSendcmd":1
};
//权限字典
var roleMap = {
    "teaRole":teaRole,
    "stuRole":stuRole,
    "adminRole":adminRole
}
//设置用户信息表{loginName:UserInfoObj}
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

//用户昵称,用户ID对照表{uid:loginName}
var userIDForNickNameMap = {1:"chacha",2:"stu1",3:"stu2",4:"stu3",5:"stu4",6:"stu5"};

//教室Map,{rid:roomInfoObj}
var roomIdOffset = 0;
var roomMap = {};
//函数声明---------------------------------------------------------------------------------------------------------------
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
            //防止socket异步处理后造成的服务器存储信息错乱
            if(this.endCompleteFunc != null){
                if(this.endCompleteArgs){
                    this.endCompleteFunc.apply(null,this.endCompleteArgs);
                }else{
                    this.endCompleteFunc();
                }
                this.endCompleteFunc = null;
                this.endCompleteArgs = null;
            }
        })

        newConnectIns.on("error",function(err){
            //客户端为正常断开socket也会触发这里,而不触发 end事件
            console.log("socket出错断开");
            destroySocket(this);
            //防止socket异步处理后造成的服务器存储信息错乱
            if(this.endCompleteFunc != null){
                if(this.endCompleteArgs){
                    this.endCompleteFunc.apply(null,this.endCompleteArgs);
                }else{
                    this.endCompleteFunc();
                }
                this.endCompleteFunc = null;
                this.endCompleteArgs = null;
            }
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

/**
 * 通过UID和SID检索出一个可用的socket链接
 * @param sid int socketID
 * @param uid int userID
 * return socket  有可能为null
 * */
function getSocketByUIDAndSID(sid,uid){
    var sock = null;
    var sidKey = sid.toString();
    var uidKey = uid.toString();
    if(unOwnedConnect.hasOwnProperty(sidKey)){
        sock = unOwnedConnect[sidKey];
    }else if(ownedConnect.hasOwnProperty(sidKey)){
        sock = ownedConnect[sidKey];
    }else if(ownedConnectUIDMap.hasOwnProperty(uidKey)){
        sock = ownedConnectUIDMap[uidKey];
    }
    return sock;
}

/**
 * 生成room邀请码
 * @param uid int userID
 * return string token字符串
 * */
function createToken(uid){
    var date = new Date().valueOf();
    var tokenStr = date + "_" + uid;
    var md5 = crypto.createHash('md5');
    return md5.update(password).digest('hex');
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
    }
    //心跳服务 s_to_c
    if(sock){
        sock.write(JSON.stringify({cmd:0x00FF0002,seq:seq + 1,c_seq:seq,st:parseInt(new Date().valueOf() / 1000)}));
    }
}

//登录服务
execFuncMap[0x00FF0003] = function(sid,dataObj){
    var loginName = dataObj.ln || "";
    var seq = dataObj["seq"] || 0;
    loginName = loginName.toLocaleLowerCase();//转小写,避免大小写账号重复问题
    var resObj = {"seq":(seq + 1),"c_seq":seq};
    var uid = -1;
    if(loginName == ""){
        resObj["code"] = 256;//登陆名不能为空
        resObj["fe"] = "登录名不能为空"
        resObj["cmd"] = 0x00FF0004;
        //向客户端发送数据
        var sock = getSocketByUIDAndSID(sid,uid);

        //登陆服务回执 s_to_c
        if(sock){
            sock.write(JSON.stringify(resObj));
        }
    }else{
        //检索用户信息数组
        if(userInfoMap.hasOwnProperty(loginName)){
            var uinfo = userInfoMap[loginName];
            var uidKey = uinfo["uid"].toString();
            uid = uinfo["uid"];
            resObj["code"] = 0;
            resObj["fe"] = "";
            resObj["nn"] = uinfo["nickName"];
            resObj["hi"] = uinfo["headerImage"];
            resObj["sex"] = uinfo["sex"];
            resObj["uid"] = uinfo["uid"];
            if(ownedConnectUIDMap.hasOwnProperty(uidKey)){
                //对之前的用户发送掉线消息
                var preSock = ownedConnectUIDMap[uidKey];
                //设置移除结束后的处理函数的参数
                preSock.endCompleteArgs = [resObj,sid,uid];
                //设置移除结束后的处理函数
                preSock.endCompleteFunc = function(obj,s_id,u_id){
                    var sidKey = s_id.toString();
                    //向当前的socket链接发送用户登录成功消息
                    //将socket链接从unOwnedConnect移动到ownedConnect中
                    if(unOwnedConnect.hasOwnProperty(sidKey))
                    {
                        //添加到新
                        ownedConnect[sidKey] = unOwnedConnect[sidKey];
                        //移除
                        unOwnedConnect[sidKey] = null;
                        delete unOwnedConnect[sidKey];
                        //添加到登陆MAP
                        ownedConnectUIDMap[uidKey] = ownedConnect[sidKey];
                    }
                    obj["cmd"] = 0x00FF0004;
                    //向客户端发送数据
                    var sock = getSocketByUIDAndSID(s_id,u_id);

                    //登陆服务回执 s_to_c
                    if(sock){
                        sock.write(JSON.stringify(obj));
                    }
                }
                //结束socket,并发送掉线通知
                preSock.end(JSON.stringify({"cmd":0x00FF0007,"seq":(seq + 1),"code":259,"reason":"其它端登陆,您已经被踢"}));
            }

        }else{
            resObj["code"] = 257;//用户不存在
            resObj["fe"] = "用户不存在"
            resObj["cmd"] = 0x00FF0004;
            //向客户端发送数据
            var sock = getSocketByUIDAndSID(sid,uid);

            //登陆服务回执 s_to_c
            if(sock){
                sock.write(JSON.stringify(resObj));
            }
        }
    }

}

//登出服务
execFuncMap[0x00FF0005] = function(sid,dataObj){
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var sock = getSocketByUIDAndSID(sid,uid);
    if(sock){
        var sidKey = sid.toString();
        var uidKey = uid.toString();
        var seq = dataObj["seq"] || 0;
        //退出频道

        //退出登陆
        if(ownedConnect.hasOwnProperty(sidKey))
        {
            //添加到未绑定UID的Map
            unOwnedConnect[sidKey] = ownedConnect[sidKey];
            //移除
            ownedConnect[sidKey] = null;
            delete ownedConnect[sidKey];
            //从登录MAP中移除
            ownedConnectUIDMap[uidKey] = null;
            delete ownedConnectUIDMap[uidKey];
        }
        sock.send(JSON({"cmd":0x00FF0006,"seq":seq + 1,"c_seq":seq}));
    }
}

//获取用户信息服务
execFuncMap[0x00FF0008] = function(sid,dataObj){
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var seq = dataObj["seq"] || 0;
    var sock = getSocketByUIDAndSID(sid,uid);
    if(sock){
        var ln = userIDForNickNameMap[uid] || "";
        var resObj = null;
        if(userInfoMap.hasOwnProperty(ln))
        {
            //检索到了用户信息
            var tempUser = userInfoMap[ln]
            resObj = {};
            resObj.uid = tempUser.uid;
            resObj.nn = tempUser.nickName;
            resObj.hi = tempUser.headerImage;
            resObj.sex = tempUser.sex;
            resObj.code = 0;
            resObj.cmd = 0x00FF0009;
            resObj.seq = seq + 1;
            resObj.c_seq = seq;
            resObj.fe = "";
        }else{
            //未检索到用户信息
            resObj = {};
            resObj.code = 257;
            resObj.cmd = 0x00FF0009;
            resObj.seq = seq + 1;
            resObj.c_seq = seq;
            resObj.fe = "用户不存在";
        }
        sock.send(JSON(resObj));
    }
}

//更新用户信息服务
execFuncMap[0x00FF000A] = function(sid,dataObj){
    var seq = dataObj["seq"] || 0;
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var sock = getSocketByUIDAndSID(sid,uid);
    if(!sock){
        return
    }
    if(uid < 0){
        sock.send(JSON({"cmd":0x00FF000B,"seq":seq + 1,"c_seq":seq,"code":257,"fe":"用户信息不存在,无法更新"}));
        return;
    }
    var ln = userIDForNickNameMap[uid] || "";
    var resObj = null;
    if(userInfoMap.hasOwnProperty(ln))
    {
        //检索到了用户信息
        //更新数据
        var user = userInfoMap[ln];
        user.sex = dataObj.sex || 1;
        user.nickName = dataObj.nn || "";
        user.headerImage = dataObj.hi || "";
        //封装返回数据
        resObj = {}
        resObj.code = 0;
        resObj.cmd = 0x00FF000B;
        resObj.seq = seq + 1;
        resObj.c_seq = seq;
        resObj.fe = "";
    }else{
        //未检索到用户信息
        resObj = {}
        resObj.code = 257;
        resObj.cmd = 0x00FF000B;
        resObj.seq = seq + 1;
        resObj.c_seq = seq;
        resObj.fe = "用户信息不存在,无法更新数据";
    }
    sock.send(JSON(resObj));

}

//创建教室服务
execFuncMap[0x00FF000C] = function(sid,dataObj){
    var seq = dataObj["seq"] || 0;
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var sock = getSocketByUIDAndSID(sid,uid);
    if(!sock){
        return
    }
    if(uid < 0){
        sock.send(JSON({"cmd":0x00FF000D,"seq":seq + 1,"c_seq":seq,"code":257,"fe":"用户信息不存在,无法创建room"}));
        return;
    }
    //创建频道
    roomIdOffset ++;
    var rid = roomIdOffset;
    var timeIntaval = new Date().valueOf();
    var roomInfo = {
        roomid:rid,/*id*/
        roomName:dataObj["rn"] || "",/*room名称*/
        roomImage:dataObj["ri"] || "",/*room图标*/
        createTime:timeIntaval,/*创建时间*/
        token:createToken(uid),/*频道邀请码*/
        owneerUID:uid,/*创建频道的人的ID*/
        userArr:[]/*当前频道中的人的信息数组*/
    }

    roomMap[rid] = roomInfo;
    //向客户端返回结果
    var resObj = {}
    resObj.code = 0;
    resObj.cmd = 0x00FF000D;
    resObj.seq = seq + 1;
    resObj.c_seq = seq;
    resObj.fe = "";
    resObj.rid = rid;
    resObj.rc = roomInfo.token;
    sock.send(JSON(resObj));

}

//查询一个用户名下的所有创建的频道信息
execFuncMap[0x00FF000E] = function(sid,dataObj){
    var seq = dataObj["seq"] || 0;
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var sock = getSocketByUIDAndSID(sid,uid);
    if(!sock){
        return
    }
    if(uid < 0){
        sock.send(JSON({"cmd":0x00FF000D,"seq":seq + 1,"c_seq":seq,"code":257,"fe":"用户信息不存在,无法创建room"}));
        return;
    }
    //创建频道
    roomIdOffset ++;
    var rid = roomIdOffset;
    var timeIntaval = new Date().valueOf();
    var roomInfo = {
        roomid:rid,/*id*/
        roomName:dataObj["rn"] || "",/*room名称*/
        roomImage:dataObj["ri"] || "",/*room图标*/
        createTime:timeIntaval,/*创建时间*/
        token:createToken(uid),/*频道邀请码*/
        owneerUID:uid,/*创建频道的人的ID*/
        userArr:[]/*当前频道中的人的信息数组*/
    }

    roomMap[rid] = roomInfo;
    //向客户端返回结果
    var resObj = {}
    resObj.code = 0;
    resObj.cmd = 0x00FF000D;
    resObj.seq = seq + 1;
    resObj.c_seq = seq;
    resObj.fe = "";
    resObj.rid = rid;
    resObj.rc = roomInfo.token;
    sock.send(JSON(resObj));

}

//主入口逻辑部分--------------------------------
if(require.main === module){
    start();
}