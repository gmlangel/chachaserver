/**
 * Created by guominglong on 2017/9/7.
 */
//class导入----------------------------------------------------------------------------------------------------------
var netClass = require("net");
var crypto = require('crypto');

//对象以及属性声明----------------------------------------------------------------------------------------------------------
var mainServer = null;//主服务器
var mainServerPort = 48888;
var connectIdOffset = 0;//客户端连接的ID ,用于生成 '客户端连接ID池';
var connectIdPool = [];//客户端连接ID池
var unOwnedConnect = {};//无主连接字典.用于记录未进入教室的用户的socket链接 {sid:socket}
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
//权限字典
var roleMap = {
    "teaRole":teaRole,
    "stuRole":stuRole
}

var roomMap = {};


//0x00ff0000 socket接入成功
//0x00FF0001 c2s心跳
//0x00FF0002 s2c心跳
//0x00FF0007 被踢掉线
//函数声明---------------------------------------------------------------------------------------------------------------
//主函数
function start(){
    mainServer = netClass.createServer(function (newConnectIns){
       // console.log(console.log(process.memoryUsage()));
        newConnectIns.sid = createConnectId();//为socket链接设置ID;
        console.log("新链接接入,socAddress:"+newConnectIns.remoteAddress + " socPort:" + newConnectIns.remotePort," sid:" + newConnectIns.sid)
        newConnectIns.uid = -1;//为其设置一个默认的uid
        newConnectIns.setTimeout(60000);//设置socket超时时间为60秒
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
            console.log("socket出错，断开");
            // //客户端为正常断开socket也会触发这里,而不触发 end事件
            // destroySocket(this);
            // //防止socket异步处理后造成的服务器存储信息错乱
            // if(this.endCompleteFunc != null){
            //     if(this.endCompleteArgs){
            //         this.endCompleteFunc.apply(null,this.endCompleteArgs);
            //     }else{
            //         this.endCompleteFunc();
            //     }
            //     this.endCompleteFunc = null;
            //     this.endCompleteArgs = null;
            // }
            // this.destroy();
        })

        newConnectIns.on("timeout",function(){
            this.end("socket超时");
        })

        newConnectIns.write(JSON.stringify({"cmd":0x00ff0000,"des":"欢迎加入茶茶服务器"}));
    });
    mainServer.listen(mainServerPort,"0.0.0.0",function(){
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
    var uid = soc.uid;
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
    var rid = soc.rid || -1;
    var roomInfo = roomMap[rid];
    if(roomInfo){
        //改socket绑定着room信息, 需要给room中的其它用户发送用户变更推送通知
        var userArr = roomInfo.userArr;
        var j = userArr.length;
        var wantRemoveObj = null;
        var wangtI = -1;
        var userIDArr = [];
        for(var i = 0 ;i<j; i++){
            if(userArr[i].uid == uid){
                wantRemoveObj = userArr[i];
                wangtI = i;
            }else{
                //填充被推送用户的ID数组
                userIDArr.push(uid);
            }
        }
        if(wantRemoveObj){
            wantRemoveObj.type = 0;
            //从用户信息数组中移除
            userArr.splice(wangtI,1);
            //向其他用户发送用户变更通知
            userStatusChangeNotify(userIDArr,[wantRemoveObj]);
        }
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
    if(sock && sock.readyState == 'open')
        return sock;
    else
        return null;
}


//心跳服务
execFuncMap[0x00FF0001] = function(sid,dataObj){
    var seq = dataObj["seq"] || 0;
    var lt = dataObj["lt"] || 0;
    var sock = getSocketByUIDAndSID(sid,-1);
    //心跳服务 s_to_c
    if(sock){
        sock.write(JSON.stringify({cmd:0x00FF0002,seq:seq + 1,c_seq:seq,st:parseInt(new Date().valueOf() / 1000)}));
    }
}



/**
 * room状态通知
 * @param uidArr Array UID数组
 * @param messageJson Object 要推送的消息数据JSON形式
 * */
function roomStatusNotify(uidArr,messageJson){
    var j = uidArr.length;
    var dataObj = {};
    dataObj.code = 0;
    dataObj.cmd = 0x00FF0013;
    dataObj.seq = 0;
    dataObj.msg = messageJson;
    var dataStr = JSON.stringify(dataObj);
    for(var i = 0 ;i < j;i++){
        var uid = uidArr[i];
        var sock = getSocketByUIDAndSID(-1,uid);
        if(sock){
            sock.write(dataStr);
        }
    }
}

//进入教室
execFuncMap[0x00FF0014] = function(sid,dataObj){
    var scriptPath = dataObj["tts"];//该教室的教材脚本地址
    var beginTime = dataObj["sti"];//课程开始时间
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var sock = getSocketByUIDAndSID(sid,uid)
    if(sock){
        var user = {};
        user.uid = uid;
        user.nn = dataObj.nn || "";
        user.hi = dataObj.hi || "";
        user.sex = dataObj.sex || 1;
        user.ca = dataObj.ca;//用户自定义属性 object类型
        var seq = dataObj["seq"] || 0;
        var resobj = {};
        resobj.cmd = 0x00FF0015;
        resobj.seq = seq + 1;
        resobj.c_seq = seq;
        if(uid <= 0){
            resobj.code = 262;
            resobj.fe = "进入room失败,uid无效"
            //向请求端发送回执消息
            sock.write(JSON.stringify(resobj));
            return;
        }
        var rid = dataObj.rid || -1;
        if(rid < 0){
            resobj.code = 263;
            resobj.fe = "进入room失败,roomId小于0,无效"
            //向请求端发送回执消息
            sock.write(JSON.stringify(resobj));
            return;
        }
        if(roomMap[rid] == null){
            
            //如果教室不存在，则创建教室
            var roomInfo = {
                roomid:rid,/*id*/
                startTimeInterval:beginTime,/*课程开始时间*/
                teachingTmaterialScript:scriptPath,/*该教室的教材脚本地址*/
                createTime:timeIntaval,/*创建时间*/
                userArr:[],/*当前频道中的人的信息数组*/
                messageArr:[],/*文本消息记录最后10条*/
                adminCMDArr:[],/*管理员命令集合*/
                tongyongCMDArr:[]/*通用教学命令集合*/
            }
            //加载教室教材脚本
            loadTeachingTmaterialScript(scriptPath);
        }
        var roominfo = roomMap[rid];
            var j = roominfo.userArr.length;
            var uidArr = [];
            var preId = -1;
            for(var i = 0 ;i < j;i++){
                if(roominfo.userArr[i].uid == user.uid){
                    //教室内存在重复的用户
                    preId = user.uid;
                }else{
                    //将用户ID记录到集合,用于发送 用户状态变更通知
                    uidArr.push(roominfo.userArr[i].uid);
                }
            }
            if(preId == -1){
                //新用户接入
                newUserClientIn(sid,uid);
            }else{
                //将之前的用户踢出，使其socket断链
                closePreUserSocket(sid,uid);
            }
            //将rid绑定到socket链接上
                sock.rid = rid;
                //加入到教室的用户列表
                roominfo.userArr.push(user);
                //向请求端发送回执消息
                resobj.code = 0;
                resobj.fe = ""
                resobj.rid = roominfo.roomid;
                resobj.ua = roominfo.userArr;
                sock.write(JSON.stringify(resobj));
                //向教室内的其它用户发送 用户状态变更通知
                var notifyUser = {};
                notifyUser.uid = user.uid;
                notifyUser.nn = user.nn;
                notifyUser.hi = user.hi;
                notifyUser.sex = user.sex;
                notifyUser.ca = user.ca;//用户自定义属性 object类型
                notifyUser.type = 1;//是进入教室 还是退出教室
                userStatusChangeNotify(uidArr,[notifyUser]);
                //向该用户推送教室内缓存的文本消息通知
                if(roominfo.messageArr.length > 0){
                    chatMSGNotify([user.uid],rid,roominfo.messageArr);
                }
                //向该用户推送管理员操作命令通知
                if(roominfo.adminCMDArr.length > 0)
                {
                    adminCMDNotify([user.uid],rid,roominfo.adminCMDArr);
                }
                //向该用户推送教学命令通知
                if(roominfo.tongyongCMDArr.length > 0){
                    tongyongCMDNotify([user.uid],rid,roominfo.tongyongCMDArr);
                }

    }
}

function closePreUserSocket(sid,uid){
    var uidKey = uid.toString();
    //对之前的用户发送掉线消息
    var preSock = ownedConnectUIDMap[uidKey];
//设置移除结束后的处理函数的参数
                preSock.endCompleteArgs = [{},sid,uid];
                //设置移除结束后的处理函数
                preSock.endCompleteFunc = function(obj,s_id,u_id){
                    var sidKey = s_id.toString();
                    //向当前的socket链接发送用户登录成功消息
                    //将socket链接从unOwnedConnect移动到ownedConnect中
                    if(unOwnedConnect.hasOwnProperty(sidKey))
                    {
                        //添加到新
                        ownedConnect[sidKey] = unOwnedConnect[sidKey];
                        ownedConnect[sidKey].uid = u_id;
                        //移除
                        unOwnedConnect[sidKey] = null;
                        delete unOwnedConnect[sidKey];
                        //添加到登陆MAP
                        ownedConnectUIDMap[uidKey] = ownedConnect[sidKey];
                    }else{
                        console.log("逻辑错误，不应该进入这个环节");
                    }
                }
                //结束socket,并发送掉线通知
                preSock.end(JSON.stringify({"cmd":0x00FF0007,"seq":(seq + 1),"code":259,"reason":"其它端登录,您已经被踢"}));                
}

/**
新用户接入
*/
function newUserClientIn(sid,uid){
                var sidKey = sid.toString();
                //向当前的socket链接发送用户登录成功消息
                //将socket链接从unOwnedConnect移动到ownedConnect中
                if(unOwnedConnect.hasOwnProperty(sidKey))
                {
                    //添加到新
                    ownedConnect[sidKey] = unOwnedConnect[sidKey];
                    ownedConnect[sidKey].uid = uid;
                    //移除
                    unOwnedConnect[sidKey] = null;
                    delete unOwnedConnect[sidKey];
                    //添加到登陆MAP
                    ownedConnectUIDMap[uidKey] = ownedConnect[sidKey];
                }
}

/**
加载教材对应的脚本
*/
function loadTeachingTmaterialScript(scriptPath){

}

/**
 * 用户状态变更通知
 * @param uidArr Array 被推送的用户ID数组
 * @param changedUserInfoArr Array 被推送的数据
 * */
function userStatusChangeNotify(uidArr,changedUserInfoArr){
    var j = uidArr.length;
    var resObj = {};
    resObj.cmd = 0x00FF0017;
    resObj.code = 0;
    resObj.fe = "";
    resObj.seq = 0;
    resObj.c_seq = 0;
    resObj.ua = changedUserInfoArr;
    var resString = JSON.stringify(resObj);
    for(var i = 0 ;i<j;i++){
        var uid = uidArr[i];
        var sock = getSocketByUIDAndSID(-1,uid);
        if(sock){
            sock.write(resString);
        }
    }
}


//发送文本消息
execFuncMap[0x00FF0018] = function(sid,dataObj){
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var sock = getSocketByUIDAndSID(sid,-1);
    if(sock == null){
        return;
    }
    var rid = sock.rid || -1;
    var roominfo = roomMap[rid];
    if(roominfo){
        //从room信息中移除用户信息
        var userArr = roominfo.userArr;
        var j = userArr.length;
        var userIDArr = [];
        for(var i = 0 ;i<j; i++){
            //填充被推送用户的ID数组
            if(userArr[i].uid != uid)
            {
                userIDArr.push(uid);
            }
        }
        //封装通知的信息数据体
        var serverTime = new Date().valueOf();
        var msg = {suid:uid,st:serverTime,lt:dataObj.lt,msg:dataObj.msg};
        //将文本消息记录在文本消息集合中
        roominfo.messageArr.push(msg);
        if(roominfo.messageArr.length > 10){
            roominfo.messageArr.splice(0,roominfo.messageArr.length - 10);
        }
        //发送文本消息通知
        chatMSGNotify(userIDArr,rid,[msg]);
    }
}

/**
 * 发送文本消息推送通知
 * */
function chatMSGNotify(uidArr,rid,msgArr){
    var notifyObj = {};
    notifyObj.cmd = 0x00FF0019;
    notifyObj.seq = 0;
    notifyObj.code = 0;
    notifyObj.rid = rid;
    notifyObj.msga = msgArr;
    var notifyStr = JSON.stringify(notifyObj);
    var j = uidArr.length;
    for(var i=0;i<j;i++){
        var uid = uidArr[i];
        var sock = getSocketByUIDAndSID(-1,uid);
        if(sock){
            sock.write(notifyStr);
        }
    }
}

//发送管理员命令
execFuncMap[0x00FF001A] = function(sid,dataObj){
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var sock = getSocketByUIDAndSID(sid,-1);
    if(sock == null){
        return;
    }
    var rid = sock.rid || -1;
    var roominfo = roomMap[rid];
    if(roominfo){
        //从room信息中移除用户信息
        var userArr = roominfo.userArr;
        var j = userArr.length;
        var userIDArr = [];
        for(var i = 0 ;i<j; i++){
            //填充被推送用户的ID数组
            if(userArr[i].uid != uid)
            {
                userIDArr.push(uid);
            }
        }
        //封装通知的信息数据体
        var serverTime = new Date().valueOf();
        var cm = {suid:uid,st:serverTime,lt:dataObj.lt,cmdObj:dataObj.cmdObj};
        //将管理员命令存放在管理员集合中
        roominfo.adminCMDArr.push(cm);
        //发送管理员命令通知
        adminCMDNotify(userIDArr,rid,[cm]);
    }
}

/**
 * 发送管理员命令通知
 * */
function adminCMDNotify(uidArr,rid,adminCMDArr){
    var notifyObj = {};
    notifyObj.cmd = 0x00FF001B;
    notifyObj.seq = 0;
    notifyObj.code = 0;
    notifyObj.rid = rid;
    notifyObj.cmda = adminCMDArr;
    var notifyStr = JSON.stringify(notifyObj);
    var j = uidArr.length;
    for(var i=0;i<j;i++){
        var uid = uidArr[i];
        var sock = getSocketByUIDAndSID(-1,uid);
        if(sock){
            sock.write(notifyStr);
        }
    }
}

//发送通用教学命令
execFuncMap[0x00FF001C] = function(sid,dataObj){
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var sock = getSocketByUIDAndSID(sid,-1);
    if(sock == null){
        return;
    }
    var rid = sock.rid || -1;
    var roominfo = roomMap[rid];
    if(roominfo){
        //从room信息中移除用户信息
        var userArr = roominfo.userArr;
        var j = userArr.length;
        var userIDArr = [];
        for(var i = 0 ;i<j; i++){
            //填充被推送用户的ID数组
            if(userArr[i].uid != uid)
            {
                userIDArr.push(userArr[i].uid);
            }
        }
        //封装通知的信息数据体
        var serverTime = new Date().valueOf();
        var data = {suid:uid,st:serverTime,lt:dataObj.lt,data:dataObj.data};
        //将通用教学命令存放在教学集合中
        roominfo.tongyongCMDArr.push(data);
        //发送管理员命令通知
        tongyongCMDNotify(userIDArr,rid,[data]);
    }
}

/**
 * 发送通用教学命令通知
 * */
function tongyongCMDNotify(uidArr,rid,tongyongCMDArr){
    var notifyObj = {};
    notifyObj.cmd = 0x00FF001D;
    notifyObj.seq = 0;
    notifyObj.code = 0;
    notifyObj.rid = rid;
    notifyObj.datas = tongyongCMDArr;
    var notifyStr = JSON.stringify(notifyObj);
    var j = uidArr.length;
    for(var i=0;i<j;i++){
        var uid = uidArr[i];
        var sock = getSocketByUIDAndSID(-1,uid);
        if(sock){
            sock.write(notifyStr);
        }
    }
}

//更新用户状态
execFuncMap[0x00FF001E] = function(sid,dataObj){
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var rid = dataObj.rid || -1;
    var roominfo = roomMap[rid];
    if (roominfo) {
        var wantObj = null;
        var userArr = roominfo.userArr;
        var j = userArr.length;
        var uidArr = [];
        for (var i = 0; i < j; i++) {
            if (userArr[i].uid == uid) {
                //更新用户状态
                wantObj = userArr[i];
                wantObj.ca = dataObj.ca;
            }else{
                //记录要推送的用户ID
                uidArr.push(userArr[i].uid)
            }
        }
        if(wantObj != null){
            //发送用户状态信息变更通知
            userStatusChangeNotify(uidArr,[wantObj]);
        }
    }
}

//主入口逻辑部分--------------------------------
if(require.main === module){
    start();
}