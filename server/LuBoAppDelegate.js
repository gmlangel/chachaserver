/**
 * Created by guominglong on 2017/9/7.
 */
//class导入----------------------------------------------------------------------------------------------------------
var netClass = require("net");
var crypto = require('crypto');
var http = require('http');
var querystring = require('querystring');


//对象以及属性声明----------------------------------------------------------------------------------------------------------
var mainServer = null;//主服务器
var mainServerPort = 59999;
var connectIdOffset = 0;//客户端连接的ID ,用于生成 '客户端连接ID池';
var connectIdPool = [];//客户端连接ID池
var unOwnedConnect = {};//无主连接字典.用于记录未进入教室的用户的socket链接 {sid:socket}
var ownedConnect = {};//有主连接字典{sid:socket}
var ownedConnectUIDMap = {};//有主连接字典{uid:socket}
var execFuncMap = {};//数据包处理函数的字典
var packageSize = 500;//拆包大小

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

var roomMap = {};//教室字典
var teachScriptMap = {};//教学脚本字典
var lessonResultMap = {};//课程报告集合

//0x00ff0000 socket接入成功
//0x00FF0001 c2s心跳
//0x00FF0002 s2c心跳
//0x00FF0007 被踢掉线
//函数声明---------------------------------------------------------------------------------------------------------------

//http请求封装 -------------------
var contents = querystring.stringify({
    name:'guominglong',
    email:'guominglong@51talk.com',
    address:'gml'
});
var options = { 
    hostname: '39.106.135.11', 
    port: 80, 
    path: '/pay/pay_callback?', 
    method: 'GET' 
}; 
var globelDate = new Date().valueOf();//全局服务器时间戳
var updateOffset = 1//更新间隔默认为1秒
//开启计时器 ,每秒执行一次
setInterval(function(){
    globelDate = new Date().valueOf();//更新服务器时间
    var room = null;
    for(var key in roomMap){
        room = roomMap[key]
        updateRoomState(room);
    }
},updateOffset * 1000);


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
        var dataStrArr = [];
        if(dataStr.indexOf("}{") > -1){
            //拆包
            while(dataStr.indexOf("}{") > -1){
                var idx = dataStr.indexOf("}{");
                var str = dataStr.substring(0,idx + 1);
                dataStr = dataStr.substring(idx + 1,dataStr.length);
                dataStrArr.push(str);
            }
        }
        dataStrArr.push(dataStr);
        var j = dataStrArr.length;
        for(var i = 0;i<j;i++){
            try{
                var obj = JSON.parse(dataStrArr[i]);
                var cmd = obj["cmd"] || 0;
                cmd = parseInt(cmd);
                console.log("收到数据包",cmd.toString(16))
                //如果存在处理函数,则进行处理
                if(execFuncMap.hasOwnProperty(cmd) && typeof(execFuncMap[cmd]) == 'function'){
                    execFuncMap[cmd](sid,obj);
                }
            }catch(errSub){
                console.log(errSub);
                console.log("数据包不是JSON字符串",dataStr);
            }
        }
    }catch(err){
        console.log(err);
        console.log("数据包拆分失败",dataStr);
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
            roomInfo.userIdArr.splice(roomInfo.userIdArr.indexOf(uid),1);
            roomInfo.answerUIDQueue.splice(roomInfo.answerUIDQueue.indexOf(uid),1);
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

/**
轮询计算并更新教室状态
*/
function updateRoomState(roomInfo){
    if(roomInfo.roomState == "end")
        return;
    if(roomInfo.roomState == "started"){
        //已经开始且教材脚本已经加载完毕
        //console.log("开始，开始，开始");
        roomInfo.currentTimeInterval += updateOffset;//更新时间计时器
        if(roomInfo.currentTimeInterval >= roomInfo.completeTime)
        {
            roomInfo.currentTimeInterval = 0;
            roomInfo.allowNewScript = true;//已经达到超时时间，为了不影响之后的脚本运行，则应该直接执行下个脚本
        }
        if(roomInfo.allowNewScript == false)
            return;
        var cmdArr = [];
        var j = teachScriptMap[roomInfo.teachingTmaterialScriptID].stepData.length;
        while(roomInfo.currentStepIdx < j){
            var scriptItem = getScriptByRoom(roomInfo)
            roomInfo.currentQuestionId = scriptItem.id;//设置当前正在提问的问题ID
            var clientScriptItem = getCSByScript(0,scriptItem);//将服务端脚本转换为客户端可以执行的脚本命令
            cmdArr.push(clientScriptItem)
            //除了换页、延迟和上墙命令外，其它的命令都需要客户端做出响应后才能继续执行
            if(scriptItem.type == "changePage"){
                roomInfo.tongyongCMDArr.splice(0,roomInfo.tongyongCMDArr.length)//移除之前的批处理教学命令缓存
                roomInfo.tongyongCMDArr.push(clientScriptItem);//添加新的教学命令缓存
            }else if(scriptItem.type == "onWall"){
                roomInfo.tongyongCMDArr.push(clientScriptItem);//添加新的教学命令缓存
            }else if(scriptItem.type == "delay"){
                //延迟一定时间后，下发下一条命令
                roomInfo.completeTime = scriptItem.value ? (scriptItem.value["timeLength"] ? parseInt(scriptItem.value["timeLength"]) : 0) : 0;
                roomInfo.allowNewScript = false;
                cmdArr.pop();//从下发命令集合中删除delay命令
                break;
            }else if(scriptItem.type == "classEnd"){
                roomInfo.tongyongCMDArr.splice(1,roomInfo.tongyongCMDArr.length - 1)//除第一条换页命令外，移除其余的命令
                roomInfo.tongyongCMDArr.push(clientScriptItem);//添加新的教学命令缓存
                roomInfo.roomState = "end";
                //测试用,重置教室，让教室可以重复利用
                roomMap[roomInfo.roomid] = null;
                delete roomMap[roomInfo.roomid];
            }else{
                switch(scriptItem.type){
                    case "templateCMD":
                        roomInfo.waitAnswerUids = roomInfo.userIdArr.concat();
                        if(roomInfo.answerUIDQueue.length > 1){
                            //存在1个以上的学生，则每次下发问题是，调换答题次序，增强交互(生产环境应该根据用户前的答题评分进行重新排序)
                            var removeId = roomInfo.answerUIDQueue.splice(0,1);
                            roomInfo.answerUIDQueue.push(removeId);
                        }
                        //设置超时等待时间和等待回答响应的用户数组
                        if(scriptItem.value)
                        {
                            roomInfo.completeTime = scriptItem.value.timeout || 30;
                        }   
                        else
                            roomInfo.completeTime = 30;
                        break;
                    case "video":
                        roomInfo.waitAnswerUids = roomInfo.userIdArr.concat();//需要所有人应答
                        //设置超时等待时间
                        if(scriptItem.value)
                            roomInfo.completeTime = (scriptItem.value.endSecond || 1) - (scriptItem.value.beginSecond || 1) + 3
                        else
                            roomInfo.completeTime = 5;
                        break;
                    case "audio":
                        roomInfo.waitAnswerUids = roomInfo.userIdArr.concat();//需要所有人应答
                        //设置超时等待时间
                        if(scriptItem.value)
                            roomInfo.completeTime = (scriptItem.value.endSecond || 1) - (scriptItem.value.beginSecond || 1) + 3
                        else
                            roomInfo.completeTime = 5;
                        break;
                    default:
                        console.log("不应该进入这个流程,roomInfo.completeTime 和 roomInfo.allowNewScript 必须同时设置")
                        break;
                }
                roomInfo.tongyongCMDArr.push(clientScriptItem)
                roomInfo.allowNewScript = false;
                break;
            }
        }
        if(cmdArr.length > 0){
            sendTeachScriptNotify(roomInfo.userIdArr,roomInfo.roomid,cmdArr,roomInfo.currentTimeInterval,roomInfo.answerUIDQueue)
        }
    }else{
        //还未开始
        roomInfo.roomState = (globelDate > roomInfo.startTimeInterval && teachScriptMap[roomInfo.teachingTmaterialScriptID]) ? "started" : roomInfo.roomState;
    }
}

function getScriptByRoom(rinfo){
    var item =  teachScriptMap[rinfo.teachingTmaterialScriptID].stepData[rinfo.currentStepIdx];
    rinfo.currentStepIdx += 1;
    return item
}

function getCSByScript(sender,data){
    return {"suid":sender,"st":globelDate,"data":data};
}


//心跳服务
execFuncMap[0x00FF0001] = function(sid,dataObj){
    var seq = dataObj["seq"] || 0;
    var lt = dataObj["lt"] || 0;
    var sock = getSocketByUIDAndSID(sid,-1);
    //心跳服务 s_to_c
    if(sock){
        writeSock(sock,JSON.stringify({cmd:0x00FF0002,seq:seq + 1,c_seq:seq,st:parseInt(new Date().valueOf() / 1000)}));
    }
}



// /**
//  * room状态通知
//  * @param uidArr Array UID数组
//  * @param messageJson Object 要推送的消息数据JSON形式
//  * */
// function roomStatusNotify(uidArr,messageJson){
//     var j = uidArr.length;
//     var dataObj = {};
//     dataObj.code = 0;
//     dataObj.cmd = 0x00FF0013;
//     dataObj.seq = 0;
//     dataObj.msg = messageJson;
//     var dataStr = JSON.stringify(dataObj);
//     for(var i = 0 ;i < j;i++){
//         var uid = uidArr[i];
//         var sock = getSocketByUIDAndSID(-1,uid);
//         if(sock){
//             sock.write(dataStr);
//         }
//     }
// }

//进入教室
execFuncMap[0x00FF0014] = function(sid,dataObj){
    var scriptID = dataObj["tts"];//该教室的教材脚本ID
    var beginTime = dataObj["sti"];//课程开始时间
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var sock = getSocketByUIDAndSID(sid,uid)
    //如果现有链路中有UID与当前uid相同，且sid与当前sid不同的sock，则将其强制退出
    var uidKey = uid.toString();
    var presoc = ownedConnectUIDMap[uidKey];
    if(presoc && presoc.sid != sid){
        //将之前的用户踢出，使其socket断链,断开成功后，执行新的进入教室
        closePreUserSocket(sid,uid,dataObj);
    }else if(!presoc){
        newUserClientIn(sid,uid);
        //全新的用户进入教室
        joinroom(sid,dataObj);
    }else if(presoc && presoc.sid == sid){
        //已经在教室的用户，又重新进入了教室
        var rid = dataObj.rid || -1;
        var roominfo = roomMap[rid];
        if(roominfo)
        {
            //先调用离开教室
            leaveRoom(sid,roominfo,uid);
            //后调用进入教室
            joinroom(sid,dataObj);
        }
        else{
            joinroom(sid,dataObj);
        }
    }else{
        console.log("错误的流程，不应该进入这个流程")
    }
}

function joinroom(sid,dataObj){
    var scriptID = dataObj["tts"];//该教室的教材脚本ID
    var beginTime = dataObj["sti"];//课程开始时间
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var sock = getSocketByUIDAndSID(sid,uid)
    if(sock){
        sock.uid = uid;
        var user = {};
        user.uid = uid;
        user.nn = dataObj.nn || "";
        user.hi = dataObj.hi || "";
        user.sex = dataObj.sex || 1;
        user.ca = dataObj.ca;//用户自定义属性 object类型
        user.type = 1;
        var seq = dataObj["seq"] || 0;
        var resobj = {};
        resobj.cmd = 0x00FF0015;
        resobj.seq = seq + 1;
        resobj.c_seq = seq;
        if(uid <= 0){
            resobj.code = 262;
            resobj.fe = "进入room失败,uid无效"
            //向请求端发送回执消息
            writeSock(sock,JSON.stringify(resobj));
            return;
        }
        var rid = dataObj.rid || -1;
        if(rid < 0){
            resobj.code = 263;
            resobj.fe = "进入room失败,roomId小于0,无效"
            //向请求端发送回执消息
            writeSock(sock,JSON.stringify(resobj));
            return;
        }
        if(roomMap[rid] == null){
            
            //如果教室不存在，则创建教室
            var newroomInfo = {
                roomid:rid,/*id*/
                roomState:"nostart",/*课程状态nostart started end*/
                currentTimeInterval:0,/*用于进行各种时间比对及计算*/
                completeTime:0,/*用于与currentTimeInterval进行各种时间比对及计算*/
                startTimeInterval:0,/*课程开始时间beginTime*/
                teachingTmaterialScriptID:scriptID,/*该教室的教材脚本地址*/
                currentStepIdx:95,/*教学脚本执行进度*/
                currentQuestionId:-1,/*当前等待应答的问题的ID*/
                allowNewScript:true,/*允许下发新的教学脚本*/
                waitAnswerUids:[],/*等待做答的用户ID数组,它是一个触发器,当allowNewScript = false时，只有waitAnswerUids长度为0，才可以重置allowNewScript的状态为true*/
                userArr:[],/*当前频道中的人的信息数组*/
                userIdArr:[],/*用户ID数组*/
                messageArr:[],/*文本消息记录最后10条*/
                adminCMDArr:[],/*管理员命令集合*/
                answerUIDQueue:[],/*用户答题序列数组*/
                tongyongCMDArr:[]/*通用教学命令集合*/
            }
            roomMap[rid] = newroomInfo;
            //加载教室教材脚本
            loadTeachingTmaterialScript(scriptID);
            //loadTeachingTmaterialScript(scriptID + 1);
            //loadTeachingTmaterialScript(scriptID + 2);
        }
        var roominfo = roomMap[rid];
            var j = roominfo.userArr.length;
            var uidArr = [];
            console.log("userArr:"+j)
            for(var i = 0 ;i < j;i++){
                if(roominfo.userArr[i].uid == user.uid){

                }else{
                    //将用户ID记录到集合,用于发送 用户状态变更通知
                    uidArr.push(roominfo.userArr[i].uid);
                }
            }

            //初始化用户相关的课程报告集合
            if(!lessonResultMap[uid + "_" + rid]){
                lessonResultMap[uid + "_" + rid] = []
            }

            //将rid绑定到socket链接上
                sock.rid = rid;
                //加入到教室的用户列表
                roominfo.userArr.push(user);
                roominfo.userIdArr.push(uid);
                roominfo.answerUIDQueue.push(uid);
                //向请求端发送回执消息
                resobj.code = 0;
                resobj.fe = ""
                resobj.rid = roominfo.roomid;
                resobj.ua = roominfo.userArr;
                writeSock(sock,JSON.stringify(resobj));
                //向教室内的其它用户发送 用户状态变更通知
                var notifyUser = {};
                notifyUser.uid = user.uid;
                notifyUser.nn = user.nn;
                notifyUser.hi = user.hi;
                notifyUser.sex = user.sex;
                notifyUser.ca = user.ca;//用户自定义属性 object类型
                notifyUser.type = user.type;//是进入教室 还是退出教室
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
                //向该用户推送正在执行的教学命令
                if(roominfo.tongyongCMDArr.length > 0){
                    sendTeachScriptNotify([user.uid],rid,roominfo.tongyongCMDArr,roominfo.currentTimeInterval,roominfo.answerUIDQueue)
                }
                //如果教材脚本加载完毕，则下推教材脚本
                if(teachScriptMap[roominfo.teachingTmaterialScriptID]){
                    
                    var teaObj = {"courseId":teachScriptMap[roominfo.teachingTmaterialScriptID].courseId,"resource":teachScriptMap[roominfo.teachingTmaterialScriptID].resource}
                    pushTeachingTmaterialScriptLoadEndNotify([user.uid],teaObj);
                }

    }
}

//退出教室
execFuncMap[0x00FF0016] = function(sid,dataObj){
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var rid = dataObj.rid || -1;
    var roominfo = roomMap[rid];
    leaveRoom(sid,roominfo,uid)
}

function leaveRoom(sid,roominfo,uid){
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
            roominfo.userIdArr.splice(roominfo.userIdArr.indexOf(uid),1)
            roominfo.answerUIDQueue.splice(roominfo.answerUIDQueue.indexOf(uid),1)
            //向其他用户发送用户变更通知
            userStatusChangeNotify(userIDArr,[wantRemoveObj]);
        }
    }
    var sock = getSocketByUIDAndSID(sid,uid)
    if(sock){
        //移除roomID与socket链接的绑定
        sock.rid = -1;
    }
}

function closePreUserSocket(sid,uid,dataObj){
    var uidKey = uid.toString();
    //对之前的用户发送掉线消息
    var preSock = ownedConnectUIDMap[uidKey];
//设置移除结束后的处理函数的参数
console.log("======>"+sid+""+uid);
                preSock.endCompleteArgs = [{},sid,uid,dataObj];
                //设置移除结束后的处理函数
                preSock.endCompleteFunc = function(obj,s_id,u_id,newDataObj){
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
                    }else{
                        console.log("逻辑错误，不应该进入这个环节");
                    }
                    //让新的用户进入教室
                    joinroom(s_id,newDataObj)
                }
                //结束socket,并发送掉线通知
                preSock.end(JSON.stringify({"cmd":0x00FF0007,"seq":(seq + 1),"code":259,"reason":"其它端登录,您已经被踢"}));                
}

/**
新用户接入
*/
function newUserClientIn(sid,uid){
                var sidKey = sid.toString();
                var uidKey = uid.toString();
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
}

/**
加载教材对应的脚本
*/
function loadTeachingTmaterialScript(scriptId){
//http://39.106.135.11/files

    var contents = querystring.stringify({
        name:'guominglong',
        email:'guominglong@51talk.com',
        address:'gml',
        randomValue:new Date().valueOf()
    });
    options.path = "/" + scriptId + ".cof?randomValue=" + new Date().valueOf();
    
    var req = http.request(options, function (res) { 
        // console.log('STATUS: ' + res.statusCode); 
        // console.log('HEADERS: ' + JSON.stringify(res.headers)); 
        res.setEncoding('utf8'); 
        res.jsonStr = "";
        res.on('data', function (chunk) {
            res.jsonStr += chunk;
            try{
                var obj = JSON.parse(res.jsonStr);
                //向原有教学命令中，添加课程结束命令
                obj.stepData = obj.stepData || [];
                obj.stepData.push({"id":0,"type":"classEnd","value":{}});
                teachScriptMap[obj.courseId] = obj;//存储加载后的脚本
                for(var roomKey in roomMap){
                    if(roomMap[roomKey].teachingTmaterialScriptID == obj.courseId){
                        pushTeachingTmaterialScriptLoadEndNotify(roomMap[roomKey]["userIdArr"],{"courseId":obj.courseId,"resource":obj.resource});//下推 教材脚本加载完毕通知
                    }
                }
            }catch(errSub){
                //console.log("=====>" + res.jsonStr)
            }
        }); 
    }); 
       
    req.on('error', function (e) { 
        console.log('problem with request: ' + e.message); 
    }); 
    req.end();
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
            writeSock(sock,resString);
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
            writeSock(sock,notifyStr);
        }
    }
}


//客户端发送管理员命令
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
        //如果需要持久化管理员命令
        if(dataObj.needCache == 1){
            //将管理员命令存放在管理员集合中
            roominfo.adminCMDArr.push(cm);
        }
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
            writeSock(sock,notifyStr);
        }
    }
}

//上报答题结果
execFuncMap[0x00FF001C] = function(sid,dataObj){
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var sock = getSocketByUIDAndSID(sid,-1);
    if(sock == null){
        return;
    }
    var questionId = dataObj.id || -1;
    questionId = parseInt(questionId);
    var rid = sock.rid || -1;
    var roominfo = roomMap[rid];
    if(roominfo){
        if(roominfo.currentQuestionId != questionId)
            return;//如果学生上报的答案，不是当前的问题的答案，则不作数
        var idx = roominfo.waitAnswerUids.indexOf(uid)
        if(idx > -1){
            //从等待答题的用户列表中移除改用户
            roominfo.waitAnswerUids.splice(idx,1);
            if(roominfo.completeTime - roominfo.currentTimeInterval < 5){
                roominfo.completeTime = roominfo.currentTimeInterval + 5;//每一个用户提交答案后进行判断，脚本执行时间不足5秒的，补充至5秒
            }
            //记录用户相关的课程报告
            lessonResultMap[uid + "_" + rid].push({"id":questionId,"data":dataObj.data});
        }
        //通过判断是否所有的用户都已经答题完毕，5秒后更新allowNewScript（“是否下发下一个教学脚本”）的状态，  5秒的时间是留给客户端播放奖励声音和动画
        if(roominfo.waitAnswerUids.length == 0){
            roominfo.completeTime = roominfo.currentTimeInterval + 5;
        }
    }
}

/**
 * 下发教学脚本
 * */
function sendTeachScriptNotify(uidArr,rid,tongyongCMDArr,playTimeInterval,answerUIDQueue){
    console.log("下发教学命令:"+globelDate)
    console.log(tongyongCMDArr)
    var notifyObj = {};
    notifyObj.cmd = 0x00FF001D;
    notifyObj.seq = 0;
    notifyObj.code = 0;
    notifyObj.rid = rid;
    notifyObj.datas = tongyongCMDArr;
    notifyObj.answerUIDQueue = answerUIDQueue;//用户答题序列（用户id的序列组）
    notifyObj.playTimeInterval = playTimeInterval;//命令已经执行了的时间 秒数
    var notifyStr = JSON.stringify(notifyObj);
    var j = uidArr.length;

    for(var i=0;i<j;i++){

        var uid = uidArr[i];
        var sock = getSocketByUIDAndSID(-1,uid);
        console.log("ceshi===>"+uidArr.length+","+uidArr[i]+","+sock)
        if(sock){
            writeSock(sock,notifyStr);
        }
    }
}

//客户端请求 课程学习报告
execFuncMap[0x00FF001E] = function(sid,dataObj){
    var uid = dataObj.uid || -1;
    uid = parseInt(uid);
    var rid = dataObj.rid || -1;
    var roominfo = roomMap[rid];
    if(roominfo){
        var arr = lessonResultMap[uid + "_" + rid];
        if(arr)
        {
            //向用户发送，用户课程报告
            sendLessonResultToUser(rid,uid,arr);
        }
    }
}

//向客户端返回报告
function sendLessonResultToUser(rid,uid,datas){
    var notifyObj = {};
    notifyObj.cmd = 0x00FF001F;
    notifyObj.seq = 0;
    notifyObj.code = 0;
    notifyObj.rid = rid;
    notifyObj.datas = datas;
    var sock = getSocketByUIDAndSID(-1,uid);
    var notifyStr = JSON.stringify(notifyObj);
    if(sock){
        writeSock(sock,notifyStr);
    }
}

/**
下推 教材脚本加载完毕通知
*/
function pushTeachingTmaterialScriptLoadEndNotify(uidArr,obj){
        var j = uidArr.length;
        var resObj = {};
        resObj.cmd = 0x00FF0020;
        resObj.code = 0;
        resObj.scriptConfigData = obj;
        var resString = JSON.stringify(resObj);
        for(var i = 0 ;i<j;i++){
            var uid = uidArr[i];
            var sock = getSocketByUIDAndSID(-1,uid);
            if(sock){
                writeSock(sock,resString);
            }
        }
}

/**
sock  拆包发送
*/
function writeSock(sock,str){
    var waitSendStr = "<gmlb>" + str + "<gmle>";
    var result = "";
    //拆包发送，  如果要发送的内容长度大于500 则拆成N个包，发送
    while(waitSendStr.length > packageSize){
        result = waitSendStr.substring(0,packageSize);
        sock.write(result);
        waitSendStr = waitSendStr.substring(packageSize,waitSendStr.length);
    }
    sock.write(waitSendStr);
}


// //更新用户状态
// execFuncMap[0x00FF001E] = function(sid,dataObj){
//     var uid = dataObj.uid || -1;
//     uid = parseInt(uid);
//     var rid = dataObj.rid || -1;
//     var roominfo = roomMap[rid];
//     if (roominfo) {
//         var wantObj = null;
//         var userArr = roominfo.userArr;
//         var j = userArr.length;
//         var uidArr = [];
//         for (var i = 0; i < j; i++) {
//             if (userArr[i].uid == uid) {
//                 //更新用户状态
//                 wantObj = userArr[i];
//                 wantObj.ca = dataObj.ca;
//             }else{
//                 //记录要推送的用户ID
//                 uidArr.push(userArr[i].uid)
//             }
//         }
//         if(wantObj != null){
//             //发送用户状态信息变更通知
//             userStatusChangeNotify(uidArr,[wantObj]);
//         }
//     }
// }

//主入口逻辑部分--------------------------------
if(require.main === module){
    start();
}