/**
 * 登录服务
 * Created by guominglong on 2017/9/5.
 */
module.exports = function(app) {
    return new LoginHandler(app);
};

var LoginHandler = function(app) {
    this.app = app;
};

/**
 * @param  {Object}   msg     request message
 * @param  {Object}   session current session object
 * @param  {Function} next    next step callback
 * @return {Void}
 */
LoginHandler.prototype.login = function(msg, session, next) {
    let loginName = msg.ln || "";
    loginName = loginName.toLocaleLowerCase();//转小写,避免大小写账号重复问题
    let resObj = {"seq":(msg.seq + 1),"c_seq":msg.seq};
    if(loginName == ""){
        resObj["code"] = 256;//登陆名不能为空
        resObj["fe"] = "登录名不能为空"
    }else{
        //检索用户信息数组
        let userInfoMap = this.app.get("userInfoMap");
        if(userInfoMap.hasOwnProperty(loginName)){
            let uinfo = userInfoMap[loginName];
            if(this.app.get("loginedArray").indexOf(uinfo["uid"]) > -1){
                //对之前的用户发送掉线消息
                this.app.pushUseroffLineMSG(uinfo["uid"],"账号在其它端登录,您已被踢");
                this.app.removeUID(uinfo["uid"]);
            }
                resObj["code"] = 0;
                resObj["fe"] = "";
                resObj["nn"] = uinfo["nickName"];
                resObj["hi"] = uinfo["headerImage"];
                resObj["sex"] = uinfo["sex"];
                resObj["uid"] = uinfo["uid"];
                session.bind(uinfo["uid"])//绑定session
                session.set("bbb",0);
                session.push();//将数据推至前端
                this.app.managerUserID(uinfo["uid"],session.id);

        }else{
            resObj["code"] = 257;//用户不存在
            resObj["fe"] = "用户不存在"
        }
    }
    next(null, resObj);
};

/**
 * @param  {Object}   msg     request message
 * @param  {Object}   session current session object
 * @param  {Function} next    next step callback
 * @return {Void}
 */
LoginHandler.prototype.logout = function(msg, session, next) {
    let uid = msg.uid || -1;
    let resObj = {"seq":(msg.seq + 1),"c_seq":msg.seq};
    if(uid < 0){
        resObj["code"] = 257;//用户不存在
        resObj["fe"] = "用户不存在"
    }else{
        if(this.app.get("loginedArray").indexOf(uid) > -1) {
            resObj["code"] = 0;
            resObj["fe"] = ""
            //将该用户从登录数组中移除
            this.app.removeUID(uid);
        }else{
            resObj["code"] = 259;
            resObj["fe"] = "用户未登陆过"
        }
    }
    next(null, resObj);
}