/**
 * Created by guominglong on 2017/9/7.
 */

  var net = require('net');
var i = 0;
class TestConnec{
    constructor(){
        this.con = net.connect({port:'49999',host:"172.16.101.61"},function(){
            console.log('l连接到服务器')

        })
        this.con.on('data',function(data){
            console.log(data.toString())
            if(i == 0){
                this.write("我是客户端")
                i++;
            }

        })

        this.con.on('end',function(data){
            console.log('断开与服务器的链接')
        })
    }


}

var obj = new TestConnec();



