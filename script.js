let webSocket;
let webSocketConnected = false;
let onWebSocketConnectedOneTime = null;
let webSocketReconnect = undefined;
let config = {};

const maxWifiNetworks = 16;
let ssidList = [];

let statuscode = 0x80;

const frameRate = 20;
let warmth = 0;
let targetWarmth = 0;
const maxWarmth = 1.0;
let tuning = false;

const wideFilterFrequencyHz = 165;
const wideFilterBandwidthHz = 70;

let filter = {
    frequency: wideFilterFrequencyHz,
    bandwidth: wideFilterBandwidthHz
};

const numberOfHistogramBins = 8;
const histogram = Array(numberOfHistogramBins).fill(0);
const tuneWindowMs = 3000;

const lowMicSampleRate = 1;
const highMicSampleRate = 5;

let audioCtx = undefined;

let onTouchOneTime = null;

const peers = [];

function init() {
    document.addEventListener( 'DOMContentLoaded', async function () {
        splide = new Splide('#carousel', {
            type: 'slide',  //don't use loop it duplicates the conent and screws up the forms
            perPage: 1,
            drag: false, // Enable drag by default
        }).mount();
        //showCarousel(false);

        splide.on('active', (slideElement) => {
            onSlideChange();
        });

        setInterval(() => { draw(); }, 1000/frameRate);

        preloadImage("img/sphere-down.png");
        preloadImage("img/sphere-up.png");

        setInterval(() => { onTick(); }, 10000);
        await getConfiguration();
        manageWebSocket(() => onStart());
        ssidList = await fetchWiFiNetworks();

        peers.push(...await fetchPeers());
        onPeersChanged();
    } );
}

function preloadImage(url) {
    const img = new Image();
    img.src = url;
}

function draw() {
    const id = getSlideIdByIndex(splide.index);

    if(sphereIsUp()) {
        const dw = targetWarmth - warmth;
        warmth = warmth + (dw * 0.1);
        setBackgroundFromValue(Math.min(Math.max(warmth, 0.0), maxWarmth) * (255/maxWarmth));
    }
    else {
        setBackgroundFromValue(0);
    }

    if(id !== 'tuning' && tuning) activateTuning(false);
}

function onTick() {
    getStatus();
}

async function getStatus() {
    let s = statuscode & 0xfe; // offline - turn off least sign bit
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); // Set timeout to abort fetch

    try {
        const response = await fetch('/yoyo/status', { signal: controller.signal });
        clearTimeout(timeout); // Clear timeout if fetch completes

        if (response.ok) {
            const json = await response.json();
            s = Number(json.statuscode);
            s = webSocketConnected ? s | 0x08 : s;
        }
    }
    catch (e) {
    }

    // Update status if it changed
    if (s !== statuscode) {
        onStatus(s);
    }
}

function sphereIsOnline(s = statuscode) {
    return (s & 0x01) == 0x01;
}

function sphereIsUp(s = statuscode) {
    return (s & 0x02) == 0x02;
}

function captivePortalRunning(s = statuscode) {
    return (s & 0x04) == 0x04;
}

function localConnected(s = statuscode) {
    return (s & 0x08) == 0x08;
}

function remoteConnected(s = statuscode) {
    return (s & 0x10) == 0x10;
}

let onSphereUp = undefined, onSphereDown = undefined;
function onStatus(s) {
    console.log('onStatus', s);
    if(statuscode != s) {
        const sphereImage = document.querySelector('#sphereImage');

        if(sphereIsUp(s)) {
            sphereImage.src = 'img/sphere-up.png';
            if(onSphereUp && typeof onSphereUp === 'function') onSphereUp();
            onSphereUp = undefined; //one time event
        }
        else {
            sphereImage.src = 'img/sphere-down.png';
            if(onSphereDown && typeof onSphereDown === 'function') onSphereDown();
            onSphereDown = undefined; //one time event
        }

        if(sphereIsOnline(s) && webSocketConnected) sphereImage.style.filter = 'none';
        else sphereImage.style.filter = 'invert(30%)';

        if(!sphereIsOnline() && sphereIsOnline(s)) onOnline();
        if(sphereIsOnline() && !sphereIsOnline(s)) onOffline();

        statuscode = s;
    }
}

function onOnline() {
    console.log("onOnline");
}

function onWebSocketConnected(v = true) {
    if(webSocketConnected !== v) {
        if(v) {
            if(onWebSocketConnectedOneTime) {
                onWebSocketConnectedOneTime();
                onWebSocketConnectedOneTime = null;
            }
        }
        else {
            if(tuning) activateTuning(false); 
        }
        webSocketConnected = v;
    }
}

function showCarousel(v) {
    var carousel = document.getElementById('carousel');
    carousel.style.visibility = v ? 'visible' : 'hidden';
    carousel.style['pointer-events'] = v ? 'auto' : 'none';
}

function onOffline() {
    console.log("onOffline");
    onWebSocketConnected(false);
}

async function getConfiguration() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000); // Set timeout to abort fetch

    try {
        const response = await fetch('/yoyo/config', { signal: controller.signal });
        clearTimeout(timeout); // Clear timeout if fetch completes

        if (response.ok) {
            const json = await response.json();
            if(json.statuscode) {
                let s = Number(json.statuscode);
                s = webSocketConnected ? s | 0x08 : s;
                onStatus(s);
                delete json.statuscode;
            }
            setConfiguration(json, false);
        }
        else onStatus(0x00); // offline
    }
    catch (e) {
        onStatus(0x00); // offline
    }
}

async function postConfiguration() {
    let success = true;

    try {
        const response = await fetch('/yoyo/config', {
            method: 'POST',
            headers: {
                "Accept": "application/json; charset=utf-8",
                "Content-Type": "application/json"
            },
            body: JSON.stringify(config)
        });

        if(response.ok) {
            success = true;
        }
        else {
            success = false;
            console.log(response.statusText);
        }
    }
    catch(e) {
        success = false;
        console.log(e);
    }
    
    return success;
}

async function setConfiguration(json, post = true, rebootDelayMs = -1) {
    let success = true;

    if (config == null) {
        success = false;
    }
    else {
        console.log("setConfiguration", json);
        config = { ...config, ...json };

        console.log(JSON.stringify(config));

        if(post) {
            success = postConfiguration();
        }

        if(success) {
            if(post && rebootDelayMs >= 0) {
                const reboot = function () {
                    showSlide('landing');   //TODO: explain reboot
                    setTimeout(function() {
                        fetch('/yoyo/reboot', {method: 'POST'});
                    }, rebootDelayMs);
                };

                // if(sphereIsUp()) onSphereDown = reboot;
                // else reboot();
                reboot();
            }
        }
    }

    return success;
}

function onStart() {
    console.log("onStart", config);

    addPeerConsoleText(JSON.stringify(config.peers)+'\n');

    if(!config?.mic?.frequency) {
        showSlide('tuning');
    }
    else {
        console.log(config.mic);
        if(!config?.server?.host) {
            showSlide('server');
        }
        else {
            console.log(config.server);
            if(!config?.wifi?.ssid || captivePortalRunning()) {
                showSlide('wifi');
            }
            else {
                console.log(config.wifi);
                showSlide('room');
            }
        }
    }

    document.getElementById('spherename').innerText = config?.captiveportal?.ssid || '';
    document.getElementById('sphereversion').innerText = config?.version || '';

    setMic({r:-1});
}

async function onSlideMoved() {
    console.log('onSlideMoved');
}

async function activateTuning(v = true) {
    const button = document.getElementById('tune_button');

    if (v && webSocketConnected) {
        tuning = true; // Set tuning to true - samples will be added to histogram
        button.classList.add('active'); // Add the active class
        filter = {
            frequency: wideFilterFrequencyHz,
            bandwidth: wideFilterBandwidthHz
        };
        setMic({f:filter.frequency, bw:filter.bandwidth, r:highMicSampleRate});
        tuneSphere();
    } else {
        tuning = false; // Set tuning to false
        button.classList.remove('active'); // Remove the active class
        setMic({r:-1});
    }
}

async function onSlideChange() {
    const id = getSlideIdByIndex(splide.index);
    switch (id) {
        case 'landing':
            break;
        case 'tuning':
            document.getElementById('tune_button').addEventListener('click', function (e) {
                console.log('tune_button clicked');
                if(audioCtx === undefined) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                activateTuning(!tuning);
            });
            const miclevel = document.getElementById('miclevel');
            miclevel.value = (config?.mic?.level || 1.0) * 10;
            miclevel.addEventListener('change', function() {
                const v = Math.max(0.1, miclevel.value/10);
                setMic({l:v});
                config.mic.level = v;
                setConfiguration({mic: config.mic});
            });
            
            break;

        case 'server':
            document.getElementById('server_name').value = config?.server?.name || '';
            document.getElementById('server_host').value = config?.server?.host || '';
            document.getElementById('server_channel').value = config?.server?.room?.channel || '';

            document.getElementById('server_button').addEventListener('click', function(e) {onServerSaveEvent(e);});
            break;

        case 'wifi':
            const ssid = document.getElementById('wifi_ssid');
            ssid.disabled = true;
            
            const secret = document.getElementById('wifi_secret');
            secret.disabled = true;
            secret.addEventListener('keypress', function(e) {if (e.keyCode == 13) onWiFiSaveEvent(e);});

            const button = document.getElementById('wifi_button');
            button.addEventListener('click', function(e) {
                onWiFiSaveEvent(e);
            });

            populateWiFiForm(config, ssidList);
            break;
        
        case 'room':
            break;

        case 'determination':
            break;

        case 'volume':
            onTouchOneTime = function() { showNextSlide(); };
            break;

        default:
            console.log("no rule for: " + id);
    }
}

function isWarm() {
    return warmth > (0.85 * maxWarmth);
}

function tuneSphere() {
    //console.log('tuneSphere', tuning);

    if(tuning) {
        const peakFrequency = getGoodHistogramPeak(histogram);
        clearHistogram(histogram);
        
        let done = true;
        if(peakFrequency != -1) {
            if(isWarm()) {
            }
            else {
                console.log("peakFrequency:" + peakFrequency);
                done = false;
            }
        }
        else done = false;

        if(!done) {
            setTimeout(() => {
                tuneSphere();
            }, tuneWindowMs);
        }
        else {
            activateTuning(false);

            const bw = 30;  //Math.ceil(filter.bandwidth / histogram.length);
            filter = {
                frequency: peakFrequency,
                bandwidth: bw
            };
            
            console.log('*** peak frequency is: ', filter.frequency, filter.bandwidth);
            setMic({f:filter.frequency, bw:filter.bandwidth, r:-1});
            
            setConfiguration({
                "mic": {
                    "frequency": peakFrequency,
                    "bandwidth": bw
                }
            });

            const toneDurationMs = 4000;
            playTone(filter.frequency, toneDurationMs, 0.5);
            setTimeout(function() {
                showNextSlide();
            }, toneDurationMs);
        }
    }
}

function showNextSlide() {
    splide.go('>');
}

function showSlide(id) {
    console.log('showSlide', id);
    if(splide) {
        const i = getSlideIndexById(id);
        if(i >= 0 && i != splide.index) splide.go(i);
    }
}

function getSlideIndexById(id) {
    const track = document.querySelector('.splide__track'); // Select the track container
    const slides = track.querySelectorAll('.splide__slide'); // Get all slides within the track
    let index = -1; // Default to -1 in case the slide ID is not found

    slides.forEach((slide, idx) => {
        if (slide.getAttribute('data-id') === id) {
        index = idx;
        }
    });

    return index;
}

function getSlideIdByIndex(index) {
    const track = document.querySelector('.splide__track'); // Select the track container
    const slides = track.querySelectorAll('.splide__slide'); // Get all slides within the track
    
    if (index >= 0 && index < slides.length) {
      return slides[index].getAttribute('data-id');
    }
    
    return null;
}

async function setMic(json) {
    try {
        const response = await fetch('/yoyo/mic', {
            method: 'POST',
            headers: {
                "Accept": "application/json; charset=utf-8",
                "Content-Type": "application/json"
            },
            body: JSON.stringify(json)
        });

        if(response.ok) {
            console.log(response);
        }
    }
    catch(e) {
        console.log(e);
    }
}

function redirect(url) {
    location.href = url;
}

async function fetchWiFiNetworks() {
    try {
        let response = await fetch('/yoyo/networks');
        if (!response.ok) throw new Error("Failed to fetch networks");

        const json = await response.json();
        if (!Array.isArray(json) || json.length === 0) return [];

        // Deduplicate SSIDs, keeping the strongest signal (highest RSSI)
        return Object.values(
            json.reduce((acc, network) => {
                if (!acc[network.SSID] || network.RSSI > acc[network.SSID].RSSI) {
                    acc[network.SSID] = network;
                }
                return acc;
            }, {})
        ).map(i => i.SSID);
    } catch (error) {
        console.error("Error fetching WiFi networks:", error);
        return []; // Return an empty list on error
    }
}

function populateWiFiForm(config, ssidList = []) {
    let networks = document.getElementById('wifi_ssid');
    networks.innerHTML = ''; // Clear existing options

    ssidList = ssidList.slice(0, maxWifiNetworks); // Limit the number of networks

    const savedNetwork = config?.wifi?.ssid || '';

    ssidList.forEach((ssid) => {
        let option = document.createElement("option");
        option.value = ssid;
        option.textContent = ssid;
        networks.appendChild(option);
        if (ssid === savedNetwork) {
            option.selected = true;
            document.getElementById('wifi_secret').value = config?.wifi?.secret || '';
        }
    });

    // Handle case where the saved network is not in the list
    if (savedNetwork && !ssidList.includes(savedNetwork)) {
        let option = document.createElement("option");
        option.value = savedNetwork;
        option.textContent = savedNetwork;
        option.disabled = true;
        networks.insertBefore(option, networks.firstChild);
    }

    // Handle empty list case
    if (networks.options.length === 0) {
        let noNetworks = document.createElement("option");
        noNetworks.textContent = "No Networks Found";
        noNetworks.disabled = true;
        networks.appendChild(noNetworks);
    } else {
        document.getElementById('wifi_secret').removeAttribute("disabled");
        networks.removeAttribute("disabled");
    }
}

async function onWiFiSaveEvent(event) {
    console.log("onWiFiSaveEvent");
    event.preventDefault();

    const ssid = document.getElementById('wifi_ssid').value;
    const secret = document.getElementById('wifi_secret').value;

    if(ssid && ssid.length > 0) {
        setConfiguration({
            "wifi": {
                "ssid": ssid,
                "secret": secret,
            },
        }, true, 5000);
    }
}

async function onServerSaveEvent(event) {
    console.log("onServerSaveEvent");
    event.preventDefault();

    const name = document.getElementById('server_name').value;
    const host = document.getElementById('server_host').value;
    const channel = document.getElementById('server_channel').value;

    setConfiguration({
        "server": {
            "name": name,
            "host": host,
            "channel": {
                "room": channel
            }
        }
    });
}

async function fetchPeers() {
    try {
        let response = await fetch('/yoyo/peers');
        if (!response.ok) throw new Error("Failed to fetch networks");

        const json = await response.json();
        if (!Array.isArray(json) || json.length === 0) return [];
        else return json;
    } catch (error) {
        console.error("Error fetching peers:", error);
        return []; // Return an empty list on error
    }
}

//---
function webSocketConnect() {
    let webSocketURL = 'ws://' + getHost() + ':81/';
    console.log('Attempting to open ' + webSocketURL);

    webSocket = new WebSocket(webSocketURL);

    webSocket.onopen = function() {
        console.debug('webSocket connected');
        onWebSocketConnected();
    };

    webSocket.onmessage = async function(event) {
        onWebSocketConnected(true);
        parseLocalMessage(JSON.parse(event.data));
    }
    
    webSocket.onclose = function(e) {
        onWebSocketConnected(false);
    };

    webSocket.onerror = function(event) {
        console.debug('webSocket.onerror', event);
    };
}

function manageWebSocket(onConnectedOneTime = null) {
    onWebSocketConnectedOneTime = onConnectedOneTime;

    if(!webSocketReconnect) {
        webSocketReconnect = function() { if(!webSocketConnected && sphereIsOnline()) webSocketConnect(); };
        webSocketReconnect();
        setInterval(webSocketReconnect, 10000);
    }
}

function parseLocalMessage(json) {
    if(json) {
        if(json['status']) {
            let s = json['status'];
            s = webSocketConnected ? s | 0x08 : s;
            if (s !== statuscode) {
                onStatus(s);
            }
        }

        if(json['type'] === 'debug')    parseLocalDebugMessage(json);
        if(json['type'] === 'peer')     parseLocalPeerMessage(json);
        if(json['type'] === 'sound')    parseLocalSoundMessage(json);
        if(json['type'] === 'touch')    parseLocalTouchMessage(json);
    }
}

function parseLocalDebugMessage(json) {
    console.log('debug', json);
}

function onPeersChanged() {
    addPeerConsoleText('[');
    peers.forEach(function(id) {
        addPeerConsoleText(id + '(' + config?.peers[id]?.user + '),');
    });
    addPeerConsoleText(']\n');
}

function parseLocalPeerMessage(json) {
    //{"type":"peer","status":19,"id":48461,"arrived":true}
    if (json.id) {
        const index = peers.indexOf(json.id);
        if (json.arrived && index === -1) {
            peers.push(json.id);
        }
        else if (!json.arrived && index >= 0) {
            peers.splice(index, 1);
        }
    }
    onPeersChanged();
}

function addPeerConsoleText(text) {
    const peerConsole = document.getElementById('peerconsole');
    if (peerConsole) {
        peerConsole.value += text;
        peerConsole.scrollTop = peerConsole.scrollHeight;
    } 
}

function parseLocalSoundMessage(json) {
    //console.log('parseLocalSoundMessage' + JSON.stringify(json));

    const f = json['f'];
    const v = json['v'];
    const e = json['e'];
    
    targetWarmth = e / 5;
    if(tuning) addSampleToHistogram(f,v);
}

function parseLocalTouchMessage(json) {
    //console.log('touch', json);
    if(onTouchOneTime) {
        onTouchOneTime();
        onTouchOneTime = null;
    }
}

function getHost() {
    let host = window.location.host;
    if(host.length > 0) {
        //Take off any port number:
        let i = host.indexOf(":");
        if(i >= 0) host = host.slice(0, i);

        //Make sure this is an IP address (can be captive.apple.com etc):
        let ipAddress = host.split('.');
        if(ipAddress.length == 4 && parseInt(ipAddress[0]) != NaN) {
            //IP address looks OK
        }
        else {
            host = '192.168.4.1';
        }
    }
    else host = '192.168.4.1';

    return(host);
}

function setBackgroundFromValue(value) {
    const clamp = (num, min, max) => Math.min(Math.max(num, min), max);
    const lerp = (start, end, t) => start + (end - start) * t;

    // Clamp value and apply ease-in
    value = clamp(value, 0, 255) / 255;
    value = value * value; // easing

    const startColor = { r: 245, g: 245, b: 245 }; // #f5f5f5
    const endColor = { r: 255, g: 215, b: 0 };     // #ffd700

    const r = Math.round(lerp(startColor.r, endColor.r, value));
    const g = Math.round(lerp(startColor.g, endColor.g, value));
    const b = Math.round(lerp(startColor.b, endColor.b, value));

    document.body.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
}

function addSampleToHistogram(f, v) {
    const fl = filter.frequency - (filter.bandwidth/2);
    const fh = filter.frequency + (filter.bandwidth/2);
    const binSize = filter.bandwidth/histogram.length;

    const n = Math.floor((f - fl)/binSize);
    if(n >= 0 && n < histogram.length){
        histogram[n] += v;
    }
}

function clearHistogram(histogram) {
    for (let i = 0; i < histogram.length; i++) histogram[i] = 0;
}

function findHistogramPeak(histogram) {
    if (histogram.length === 0) return { value: null, position: -1 };
    
    let peakValue = Math.max(...histogram);
    let peakIndex = histogram.indexOf(peakValue);
    
    return { value: peakValue, position: peakIndex };
}

function calculateHistogramStats(histogram) {
    if (histogram.length === 0) return { mean: null, sd: null };

    const sum = histogram.reduce((acc, value) => acc + value, 0);
    const mean = sum / histogram.length;

    const variance = histogram.reduce((acc, value) => acc + Math.pow(value - mean, 2), 0) / histogram.length;
    const sd = Math.sqrt(variance);

    return { mean, sd };
}

const minHistogramPeakValue = 1.0;  //at highMicSampleRate (5 per second) and tuneWindowMs (3000)
function getGoodHistogramPeak(histogram) {
    let result = -1;

    if (histogram.length === 0) return -1;

    const { mean, sd } = calculateHistogramStats(histogram);
    const peak = findHistogramPeak(histogram);

    if (peak.value > minHistogramPeakValue && peak.value > mean + (2 * sd)) {
        const binWidth = filter.bandwidth / histogram.length;
        result = Math.floor(filter.frequency - (filter.bandwidth/2) + (peak.position * binWidth) + (binWidth/2));
    }

    return result;
}

// Function to play a tone
function playTone(frequency, durationMs, volume) {
    if(audioCtx === undefined) return;

    const duration = durationMs / 1000;

    // Ensure the context is resumed after a user interaction
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    // Create an oscillator node for the tone
    const oscillator = audioCtx.createOscillator();
    oscillator.type = 'sine'; // 'sine', 'square', 'sawtooth', or 'triangle'
    oscillator.frequency.setValueAtTime(frequency, audioCtx.currentTime); // Set frequency
  
    // Create a GainNode for volume control
    const gainNode = audioCtx.createGain();
  
    // Connect the oscillator to the GainNode, then to the destination (speakers)
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
  
    // Add fade-in and fade-out
    const fadeTime = duration * 0.2; // Fade duration (seconds)
    const startTime = audioCtx.currentTime; // Current audio context time
    const endTime = startTime + duration;
  
    // Set initial gain to 0 (silent)
    gainNode.gain.setValueAtTime(0, startTime);
  
    // Fade in
    gainNode.gain.linearRampToValueAtTime(volume, startTime + fadeTime);
  
    // Sustain volume for the middle of the tone
    gainNode.gain.setValueAtTime(volume, endTime - fadeTime);
  
    // Fade out
    gainNode.gain.linearRampToValueAtTime(0, endTime);
  
    // Start and stop the oscillator
    oscillator.start(startTime); // Start immediately
    oscillator.stop(endTime); // Stop after the specified duration
  }

init();