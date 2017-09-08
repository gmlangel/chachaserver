/**
 * 服务器管理类
 * Created by guominglong on 2017/9/7.
 */
var net = require('net');
module.exports = function (app){
    return new GMLServer(app)
}

class GMLServer{
    constructor(app){
        this.app = app
        this.unOwnedSockMap = {};//无主socket链接集合
        this.ownedSockMap = {};//有主socket链接集合
        this.server = null;//服务器
    }


    start(host='localhost',port='49999'){
        if(this.server == null){
            this.server = net.createServer(this.newConnectionIn)
            this.server.listen(port,host,this.onServerCreateComplete);
        }
    }

    /**
     * 当有新的客户端连接接入
     * */
    newConnectionIn(connec){
        console.log("client connect",connec);
    }

    onServerCreateComplete(){
        console.log(this.address());
    }

}
