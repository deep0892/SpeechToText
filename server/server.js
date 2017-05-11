/**
 * Created by noamc on 8/31/14.
 */
 var binaryServer = require('binaryjs').BinaryServer,
     https = require('https'),
     wav = require('wav'),
     opener = require('opener'),
     fs = require('fs'),
     connect = require('connect'),
     serveStatic = require('serve-static'),
     UAParser = require('./ua-parser'),
     CONFIG = require("../config.json"),
     lame = require('lame');

    const Speech = require('@google-cloud/speech');
    const speech = Speech();

    var uaParser = new UAParser();
    var os = require("os");

    var MongoClient = require('mongodb').MongoClient;
    var assert = require('assert');
    var ObjectId = require('mongodb').ObjectID;
    var url = 'mongodb://10.0.8.76:27017/SpeechToText';


 if(!fs.existsSync("recordings"))
    fs.mkdirSync("recordings");

var events = require('events');
require('events').EventEmitter.prototype._maxListeners = 100;
var eventEmitter = new events.EventEmitter();
eventEmitter.setMaxListeners(0);

var servercount = 0 ;
var clientcount = 0 ;

var options = {
    key:    fs.readFileSync('ssl/server.key'),
    cert:   fs.readFileSync('ssl/server.crt'),
};

var app = connect();

app.use(serveStatic('public'));

var server = https.createServer(options,app);
var io = require('socket.io').listen(server);
server.listen(9191);

var insertDocument = function( db, msg, callback) {
    db.collection('textResponse').findOne(
        {
             "uid" :  msg.uid,
             "leadid" : msg.leadid
        }, function(err, result) {
            assert.equal(err, null);
            console.log("inside fetch document ");
            console.log(result);
            if(result && result.leadid){
                console.log('record already exists');
                var text = result.speech;
                var newspeech = text + msg.textresponse;        
                db.collection('textResponse').updateOne(
                    { 
                        "uid" : msg.uid,
                        "leadid" : msg.leadid
                    },
                    {
                        $set: { "speech": newspeech }
                    }, function(err, result) {
                    assert.equal(err, null);
                    console.log("Updated a document ");
                    callback();
                });
            }else{
                db.collection('textResponse').insertOne( {
                    "leadid" : msg.leadid,
                    "uid" :  msg.uid,
                    "speech": msg.textresponse,
                    ts: new Date()
                }, function(err, result) {
                    assert.equal(err, null);
                    console.log("Inserted a document");
                    callback();
                });
            }
        });
};

var server = binaryServer({server:server});
server.setMaxListeners(0);

io.on('connection', function(socket){
    console.log('socket');
    console.log(socket.id);
    server.on('connection', function(client) {
        servercount++;
        console.log("new connection..." + servercount);
        var fileWriter = null;
        var writeStream = null;
        var userAgent  = client._socket.upgradeReq.headers['user-agent'];
        console.log(userAgent);
        uaParser.setUA(userAgent);
        var ua = uaParser.getResult();

    // The encoding of the audio file, e.g. 'LINEAR16'
    const encoding = 'LINEAR16';

    // The sample rate of the audio file in hertz, e.g. 16000
    const sampleRateHertz = 44100;

    // The BCP-47 language code to use, e.g. 'en-US'
    const languageCode = 'hi-IN';

    const request = {
        config: {
        encoding: encoding,
        sampleRateHertz: sampleRateHertz,
        languageCode: languageCode,
        //enableWordTimeOffsets: true,
        //maxAlternatives: 10,
        //profanityFilter: true,
        speechContexts: {
            phrases:["good morning","policybazaar.com","policybazaar","sir", "health","insurance","policy","right","age", "good", "morning","nineteen","ninety seven","forty","thirty eight"]
            }
        },
        interimResults: true ,
        //singleUtterance: true
        };
        console.log('before stream');
        client.on('error', console.error)
            .on('stream', function(stream, meta) {
                clientcount++;
                console.log('inside stream.on: ' + clientcount);
            console.log("Stream Start@" + meta.sampleRate +"Hz");
            var fileName = "recordings/"+ ua.os.name  + "_" + new Date().getTime();
            var result = "Result: "+ ua.os.name  + "_" + new Date().getTime();
            switch(CONFIG.AudioEncoding){
                case "WAV":
                    console.log('before stream.pipe');
                    stream.pipe(speech.createRecognizeStream(request)
                                    .on('error', () => {
                                        console.log('inside onerror');    
                                        io.to(socket.id).emit('start-new-recording', 'start recoirding from server emitted!');
                                    })
                                    .on('data', (data) =>  {
                                        console.log('data recieved from speech api'); 
                                        process.stdout.write(data.results);
                                        // if(data && data.results){
                                        //     MongoClient.connect( url, function(err, db) {
                                        //         assert.equal(null, err);
                                        //         insertDocument(db , data.results, function() {
                                        //             db.close();
                                        //         });
                                        //     });
                                        // }
                                        //io.sockets.emit('message-from-speechapi', data.results);
                                        io.to(socket.id).emit('message-from-speechapi',data.results);
                                        socket.on('InsertIntoMongo', function(msg) {
                                            console.log('InsertIntoMongo');
                                            console.log(msg);
                                            MongoClient.connect( url, function(err, db) {
                                                assert.equal(null, err);
                                                insertDocument(db , msg, function() {
                                                    db.close();
                                                });
                                            });
                                        });                          
                                        fs.appendFile("speechtext.txt", result + data.results + os.EOL, function(err) {
                                            if(err) {
                                                return console.log(err);
                                            }
                                            console.log("The file was saved!");
                                        });
                                    }));
                    fileWriter = new wav.FileWriter(fileName + ".wav", {
                        channels: 1,
                        sampleRate: meta.sampleRate,
                        bitDepth: 16 });
                    stream.pipe(fileWriter);
                break;
                case "MP3":
                    writeStream = fs.createWriteStream( fileName + ".mp3" );
                    stream.pipe( new lame.Encoder(
                    {
                        channels: 1, bitDepth: 16, sampleRate: 44100, bitRate: 128, outSampleRate: 22050, mode: lame.MONO
                    })
                    )
                    .pipe( writeStream );
                break;
            };
        });
        client.on('close', function() {
            if ( fileWriter != null ) {
                fileWriter.end();
            } else if ( writeStream != null ) {
                writeStream.end();
            }
            console.log("Connection Closed");
        });
    });
});