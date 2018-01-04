/**
 * Created by guominglong on 2017/9/7.
 */
//class导入----------------------------------------------------------------------------------------------------------
var WebSocketServer = require('ws').Server
var crypto = require('crypto');

//对象以及属性声明----------------------------------------------------------------------------------------------------------
var mainServer = null;//主服务器
var mainServerPort = 31111;
var connectIdOffset = 0;//客户端连接的ID ,用于生成 '客户端连接ID池';
var connectIdPool = [];//客户端连接ID池
var unOwnedConnect = {};//无主连接字典.用于记录未经登陆的用户的socket链接 {sid:socket}
var ownedConnect = {};//有主连接字典{sid:socket}
var ownedConnectUIDMap = {};//有主连接字典{uid:socket}
var execFuncMap = {};//数据包处理函数的字典
var waitTuiSongPosition={};//等待推送的用户坐标数据
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
}

/**
男孩资源数组
*/
var resourcePathArr_boy = ["./resource/boy1/","./resource/boy2/"]

/**
女孩资源数组
*/
var resourcePathArr_girl = ["./resource/girl1/","./resource/girl2/"]

//用户昵称,用户ID对照表{uid:loginName}
var userIDForNickNameMap = {};

//教室Map,{rid:roomInfoObj}
var roomIdOffset = 0;
var roomMap = {}
roomMap[1] ={
        roomid:1,/*id*/
        roomName:"ceshi",/*room名称*/
        roomImage:"",/*room图标*/
        createTime:0,/*创建时间*/
        token:"testchanel",/*频道邀请码*/
        owneerUID:0,/*创建频道的人的ID*/
        userArr:[],/*当前频道中的人的信息数组*/
        messageArr:[],/*文本消息记录最后10条*/
        adminCMDArr:[],/*管理员命令集合*/
        tongyongCMDArr:[]/*通用教学命令集合*/
    }
//函数声明---------------------------------------------------------------------------------------------------------------
//主函数
function start(){

    mainServer = new WebSocketServer({ port: 31111,host:"0.0.0.0"});
    mainServer.on('connection', function (newConnectIns) {
        console.log('client connected');
        newConnectIns.sid = createConnectId();//为socket链接设置ID;
        console.log("新链接接入,socAddress:"+newConnectIns._socket.remoteAddress + " socPort:" + newConnectIns._socket.remotePort," sid:" + newConnectIns.sid)
        newConnectIns.uid = -1;//为其设置一个默认的uid
        //暂时不用newConnectIns.setTimeout(60000);//设置socket超时时间为60秒
        //将socket加入到无主链接字典中
        unOwnedConnect[newConnectIns.sid.toString()] = newConnectIns;
        //添加相关事件
        newConnectIns.on("message",function(dataBuffer){
            //解析数据包remote
            analyzeDataPackage(this.sid,dataBuffer);
        })

        newConnectIns.on("close",function(){
            console.log(this.sid, "断开了链接")
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
            // //this.destroy();
        })
        newConnectIns.on("timeout",function(err){
            this.end("超时")
        });
    });
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
        //console.log("收到数据包",cmd.toString(16))
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
    var nnKey = soc.nn || "";
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
                userIDArr.push(userArr[i].uid);
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
    if(nnKey != ""){
        delete userInfoMap[nnKey];
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
        if(sock.readyState != 1){
            sock = null;
        }
    }else if(ownedConnect.hasOwnProperty(sidKey)){
        sock = ownedConnect[sidKey];
        if(sock.readyState != 1){
            sock = null;
        }
    }else if(ownedConnectUIDMap.hasOwnProperty(uidKey)){
        sock = ownedConnectUIDMap[uidKey];
        if(sock.readyState != 1){
            sock = null;
        }
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
    return md5.update(tokenStr).digest('hex');
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
        sock.send(JSON.stringify({cmd:0x00FF0002,seq:seq + 1,c_seq:seq,st:parseInt(new Date().valueOf() / 1000)}));
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
            sock.send(JSON.stringify(resObj));
        }
    }else{
        //检索用户信息数组
        if(userInfoMap.hasOwnProperty(loginName)){
            //有重名的用户则重新命名
            loginName = loginName + sid;
        }
        if(!userInfoMap.hasOwnProperty(loginName)){
            //没有用户信息就创建个新的
            var sex = loginName.length % 2
            var tj = sex == 0 ? resourcePathArr_girl.length:resourcePathArr_boy.length;
            tj = parseInt(Math.random()*tj)%tj;
            var resourceP = sex == 0 ? resourcePathArr_girl[tj]:resourcePathArr_boy[tj];
            userInfoMap[loginName] = {
                "nickName":loginName,
                "headerImage":"",
                "sex":sex,
                "uid":sid,
                "loginName":loginName,
                "resourcePath":resourceP
            }
            userIDForNickNameMap[sid] = loginName;
        }
        var uinfo = userInfoMap[loginName];
            var uidKey = uinfo["uid"].toString();

            uid = uinfo["uid"];
            resObj["code"] = 0;
            resObj["fe"] = "";
            resObj["nn"] = uinfo["nickName"];
            resObj["hi"] = uinfo["headerImage"];
            resObj["sex"] = uinfo["sex"];
            resObj["uid"] = uinfo["uid"];
            resObj["loginName"] = uinfo["loginName"];
            resObj["resourcePath"] = uinfo["resourcePath"];
            if(ownedConnectUIDMap.hasOwnProperty(uidKey)){
                console.log(loginName + "_" + sid + "走进了错误的流程")
                // //对之前的用户发送掉线消息
                // var preSock = ownedConnectUIDMap[uidKey];
                // //设置移除结束后的处理函数的参数
                // preSock.endCompleteArgs = [resObj,sid,uid];
                // //设置移除结束后的处理函数
                // preSock.endCompleteFunc = function(obj,s_id,u_id){
                //     var sidKey = s_id.toString();
                //     //向当前的socket链接发送用户登录成功消息
                //     //将socket链接从unOwnedConnect移动到ownedConnect中
                //     if(unOwnedConnect.hasOwnProperty(sidKey))
                //     {
                //         //添加到新
                //         ownedConnect[sidKey] = unOwnedConnect[sidKey];
                //         ownedConnect[sidKey].uid = u_id;
                //         //移除
                //         unOwnedConnect[sidKey] = null;
                //         delete unOwnedConnect[sidKey];
                //         //添加到登陆MAP
                //         ownedConnectUIDMap[uidKey] = ownedConnect[sidKey];
                //     }
                //     obj["cmd"] = 0x00FF0004;

                //     //向客户端发送数据
                //     var sock = getSocketByUIDAndSID(s_id,u_id);
                //     //登陆服务回执 s_to_c
                //     if(sock){
                //         sock.send(JSON.stringify(obj));
                //     }
                // }
                // //结束socket,并发送掉线通知
                // preSock.end(JSON.stringify({"cmd":0x00FF0007,"seq":(seq + 1),"code":259,"reason":"其它端登陆,您已经被踢"}));
            }else{
                //新用户登录
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
                resObj["cmd"] = 0x00FF0004;
                //向客户端发送数据
                var sock = getSocketByUIDAndSID(sid,uid);
                sock.nn = resObj.nn;
                //登陆服务回执 s_to_c
                if(sock){
                    sock.send(JSON.stringify(resObj));
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
        sock.send(JSON.stringify({"cmd":0x00FF0006,"seq":seq + 1,"c_seq":seq}));
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
        sock.send(JSON.stringify(resObj));
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
        sock.send(JSON.stringify({"cmd":0x00FF000B,"seq":seq + 1,"c_seq":seq,"code":257,"fe":"用户信息不存在,无法更新"}));
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
    sock.send(JSON.stringify(resObj));

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
        sock.send(JSON.stringify({"cmd":0x00FF000D,"seq":seq + 1,"c_seq":seq,"code":257,"fe":"用户信息不存在,无法创建room"}));
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
        token:createToken(uid)+rid.toString(16),/*频道邀请码*/
        owneerUID:uid,/*创建频道的人的ID*/
        userArr:[],/*当前频道中的人的信息数组*/
        messageArr:[],/*文本消息记录最后10条*/
        adminCMDArr:[],/*管理员命令集合*/
        tongyongCMDArr:[]/*通用教学命令集合*/
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
    sock.send(JSON.stringify(resObj));

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
    //if(uid < 0){
    //    sock.send(JSON.stringify({"cmd":0x00FF000D,"seq":seq + 1,"c_seq":seq,"code":257,"fe":"用户信息不存在,无法创建room"}));
    //    return;
    //}
    //遍历roomMap,封装返回数据
    var resObj = {}
    resObj.code = 0;
    resObj.cmd = 0x00FF000F;
    resObj.seq = seq + 1;
    resObj.c_seq = seq;
    resObj.ra = [];
    for(var key in roomMap){
        var rinfo = roomMap[key];
        if(rinfo.owneerUID == uid){
            resObj.ra.push({rid:rinfo.roomid,rc:rinfo.token,rn:rinfo.roomName,ri:rinfo.roomImage});
        }
    }
    //向客户端返回结果
    sock.send(JSON.stringify(resObj));
}

//删除room
execFuncMap[0x00FF0011] = function(sid,dataObj){
    var seq = dataObj["seq"] || 0;
    var rid = dataObj.rid || -1;
    rid = parseInt(rid);
    var sock = getSocketByUIDAndSID(sid,-1);
    if(!sock){
        return
    }
    if(rid < 0){
        sock.send(JSON.stringify({"cmd":0x00FF0012,"seq":seq + 1,"c_seq":seq,"code":260,"fe":"删除room失败,room不存在"}));
        return;
    }
    //遍历roomMap,封装返回数据
    var resObj = {}
    resObj.code = 260;
    resObj.cmd = 0x00FF0012;
    resObj.seq = seq + 1;
    resObj.c_seq = seq;
    for(var key in roomMap){
        if(key == rid){
            resObj.code = 0;
            //删除频道
            roomMap[key] = null;
            delete roomMap[key];
            break;
        }
    }
    if(resObj.code == 260){
        resObj.fe = "删除room失败,room不存在";
    }
    //向客户端返回结果
    sock.send(JSON.stringify(resObj));
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
            sock.send(dataStr);
        }
    }
}

//进入教室
execFuncMap[0x00FF0014] = function(sid,dataObj){
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
        user.rp = dataObj.rp;
        var seq = dataObj["seq"] || 0;
        var roomCode = dataObj.rc || "";
        var resobj = {};
        resobj.cmd = 0x00FF0015;
        resobj.seq = seq + 1;
        resobj.c_seq = seq;
        if(roomCode == ""){
            resobj.code = 262;
            resobj.fe = "进入room失败,邀请码无效"
            //向请求端发送回执消息
            sock.send(JSON.stringify(resobj));
            return;
        }
        var rid = 1;//parseInt("0x" + roomCode.substring(32,roomCode.length));
        var roominfo = roomMap[rid];
        if(roominfo){
            var allowJoin = roominfo.token == dataObj.rc;//是否允许进入教室
            if(!allowJoin){
                resobj.code = 262;
                resobj.fe = "进入room失败,邀请码无效"
                //向请求端发送回执消息
                sock.send(JSON.stringify(resobj));
                return;
            }
            var j = roominfo.userArr.length;
            var uidArr = [];
            for(var i = 0 ;i < j;i++){
                if(roominfo.userArr[i].uid == user.uid){
                    //教室内存在重复的用户,则不允许再次进入教室
                    allowJoin = false;
                    break;
                }else{
                    //将用户ID记录到集合,用于发送 用户状态变更通知
                    uidArr.push(roominfo.userArr[i].uid);
                }
            }
            if(allowJoin){
                //将rid绑定到socket链接上
                sock.rid = rid;
                //加入到教室的用户列表
                roominfo.userArr.push(user);
                //向请求端发送回执消息
                resobj.code = 0;
                resobj.fe = ""
                resobj.rid = roominfo.roomid;
                resobj.rn = roominfo.roomName;
                resobj.ri = roominfo.roomImage;
                resobj.ua = roominfo.userArr;
                sock.send(JSON.stringify(resobj));
                //向教室内的其它用户发送 用户状态变更通知
                var notifyUser = {};
                notifyUser.uid = user.uid;
                notifyUser.nn = user.nn;
                notifyUser.hi = user.hi;
                notifyUser.sex = user.sex;
                notifyUser.ca = user.ca;//用户自定义属性 object类型
                notifyUser.rp = user.rp
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
            }else{
                resobj.code = 261;
                resobj.fe = "进入room失败,该用户已经再room中"
                //向请求端发送回执消息
                sock.send(JSON.stringify(resobj));
            }
        }else{
            resobj.code = 260;
            resobj.fe = "进入room失败,room不存在"
            //向请求端发送回执消息
            sock.send(JSON.stringify(resobj));
        }

    }
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
            sock.send(resString);
        }
    }
}

//退出教室
execFuncMap[0x00FF0016] = function(sid,dataObj){
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var rid = dataObj.rid || -1;
    var roominfo = roomMap[rid];
    if(roominfo){
        //从room信息中移除用户信息
        var userArr = roominfo.userArr;
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
            if(userArr.length){
                //教室里已经没有人了,清空缓存的所有数据
                roominfo.messageArr.splice(0);
                roominfo.adminCMDArr.splice(0);
                roominfo.tongyongCMDArr.splice(0);
            }
        }
    }
    var sock = getSocketByUIDAndSID(sid,uid)
    if(sock){
        //移除roomID与socket链接的绑定
        sock.rid = -1;
    }
}

//发送文本消息
execFuncMap[0x00FF0018] = function(sid,dataObj){
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var rid = dataObj.rid || -1;
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
            sock.send(notifyStr);
        }
    }
}

//发送管理员命令
execFuncMap[0x00FF001A] = function(sid,dataObj){
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var rid = dataObj.rid || -1;
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
        var cm = {suid:uid,st:serverTime,lt:dataObj.lt,cmd:dataObj.cmd};
        //将文本消息记录在文本消息集合中
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
            sock.send(notifyStr);
        }
    }
}

//发送通用教学命令
execFuncMap[0x00FF001C] = function(sid,dataObj){
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var rid = dataObj.rid || -1;
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
        //将文本消息记录在文本消息集合中
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
            sock.send(notifyStr);
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

//收到用户动画数据
execFuncMap[0x00FF101E] = function(sid,dataObj){
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var rid = dataObj.rid || -1;
    // var roominfo = roomMap[rid];
    // if (roominfo) {
        //添加到等待推送列表
        waitTuiSongPosition[uid] ={"uid":uid,"x":dataObj.ca.x,"y":dataObj.ca.y}
    //}
}
//临时使用
function tuizuobiao(){
    var notifyObj = {};
    notifyObj.cmd = 0x00FF111E;
    notifyObj.seq = 0;
    notifyObj.code = 0;
    notifyObj.rid = 1;
    notifyObj.datas = waitTuiSongPosition;
    var notifyStr = JSON.stringify(notifyObj);

    var roomInfo = roomMap[1];
    var arr = roomInfo.userArr;
    var j = arr.length;
    //更新用户数据
    for(var i=0;i<j;i++){
        var key = arr[i].uid
        if(waitTuiSongPosition[key]){
            arr[i].ca.x = waitTuiSongPosition[key].x;
            arr[i].ca.y = waitTuiSongPosition[key].y
            delete waitTuiSongPosition[key];
        }
        //推送至客户端
        var sock = getSocketByUIDAndSID(-1,key);
        if(sock){
            sock.send(notifyStr);
        }
    }
    setTimeout(tuizuobiao, 50);
}
setTimeout(tuizuobiao, 50);

//主入口逻辑部分--------------------------------
if(require.main === module){
    start();
}