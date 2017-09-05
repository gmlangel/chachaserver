/**
 * 心跳服务
 * Created by guominglong on 2017/9/5.
 */
module.exports = function(app) {
    return new HeartbeatHandler(app);
};

var HeartbeatHandler = function(app) {
    this.app = app;
};

/**
 * 心跳
 * @param  {Object}   msg     request message
 * @param  {Object}   session current session object
 * @param  {Function} next    next step callback
 * @return {Void}
 */
HeartbeatHandler.prototype.step = function(msg, session, next) {
    //console.log("收到客户端心跳请求:"+msg.lt,"sessionId:"+session.get("gid"))
    session.set("gid",msg.seq);
    next(null, {"seq":(msg.seq + 1),"c_seq":msg.seq,"st":parseInt(new Date().valueOf()/1000)});
};