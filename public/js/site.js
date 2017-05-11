/**
 * Created by noamc on 8/31/14.
 */

$(function () {
    var client,
        recorder,
        context,
        bStream,
        contextSampleRate = (new AudioContext()).sampleRate;
        resampleRate = contextSampleRate,
        worker = new Worker('js/worker/resampler-worker.js');
    var socket = io().connect('https://10.0.9.96:9191/');
    worker.postMessage({cmd:"init",from:contextSampleRate,to:resampleRate});

    var leadid;
    var uid = Math.random();
    window.addEventListener('message', function(msg) {
        console.log(msg);
        if( msg && msg.data.event == 'startrecording' ){
            console.log('inside client startrecording');
            startrecording();
            leadid = msg.data.leadid;
        }else if( msg && msg.data == 'stoprecording' ){
            console.log('inside client stoprecording');
            close();
        }
    }, false);

    socket.on('start-new-recording', function(msg) {
        console.log('start-new-recording');
        console.log(msg);
        startrecording();
    });
    socket.on('message-from-speechapi', function(data) {
        console.log('message-from-speechapi');
        console.log(data);
        var speechObj = {
            textresponse: data,
            leadid: leadid,
            uid: uid
        }
        console.log(speechObj);
        socket.emit('InsertIntoMongo',speechObj);
    });

    worker.addEventListener('message', function (e) {
        if (bStream && bStream.writable)
            bStream.write(convertFloat32ToInt16(e.data.buffer));
    }, false);

    function startrecording(){
        close();
        console.log('startrecording called');
        client = new BinaryClient('wss://'+location.host);
        client.on('open', function () {
            bStream = client.createStream({sampleRate: resampleRate});
        });
        if (context) {
            recorder.connect(context.destination);
            return;
        }
        var session = {
            audio: true,
            video: false
        };
        navigator.getUserMedia(session, function (stream) {
            context = new AudioContext();
            var audioInput = context.createMediaStreamSource(stream);
            var bufferSize = 0; // let implementation decide

            recorder = context.createScriptProcessor(bufferSize, 1, 1);

            recorder.onaudioprocess = onAudio;

            audioInput.connect(recorder);

            recorder.connect(context.destination);

        }, function (e) {
        });
    }
    $("#start-rec-btn").click(function () {
        startrecording();
        });

    function onAudio(e) {
        var left = e.inputBuffer.getChannelData(0);

        worker.postMessage({cmd: "resample", buffer: left});

        drawBuffer(left);
    }

    function convertFloat32ToInt16(buffer) {
        var l = buffer.length;
        var buf = new Int16Array(l);
        while (l--) {
            buf[l] = Math.min(1, buffer[l]) * 0x7FFF;
        }
        return buf.buffer;
    }

    //https://github.com/cwilso/Audio-Buffer-Draw/blob/master/js/audiodisplay.js
    function drawBuffer(data) {
        var canvas = document.getElementById("canvas"),
            width = canvas.width,
            height = canvas.height,
            context = canvas.getContext('2d');

        context.clearRect (0, 0, width, height);
        var step = Math.ceil(data.length / width);
        var amp = height / 2;
        for (var i = 0; i < width; i++) {
            var min = 1.0;
            var max = -1.0;
            for (var j = 0; j < step; j++) {
                var datum = data[(i * step) + j];
                if (datum < min)
                    min = datum;
                if (datum > max)
                    max = datum;
            }
            context.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
        }
    }

    $("#stop-rec-btn").click(function () {
        close();
    });

    function close(){
        console.log('close');
        if(recorder)
            recorder.disconnect();
        if(client)
            client.close();
    }
});

navigator.getUserMedia = navigator.getUserMedia ||
    navigator.webkitGetUserMedia ||
    navigator.mozGetUserMedia ||
    navigator.msGetUserMedia;