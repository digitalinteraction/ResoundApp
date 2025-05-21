let rebootTimeoutId = undefined;
let saveConfigTimeOutId = undefined;
let tuningTimeOutId = undefined;

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
const maxWarmth = 5.0;
let isTuning = false;
let peakEnergy = 0;

const wideFilterFrequencyHz = 165;
const narrowFilterBandwidthHz = 15;
const wideFilterBandwidthHz = 150;

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
        allowInteraction(false);

        splide.on('active', (slideElement) => {
            updateSlide(true);
        });
        updateSlide(true);

        setInterval(() => { loop(); }, 1000/frameRate);

        preloadImage("img/sphere-down.png");
        preloadImage("img/sphere-up.png");

        setInterval(() => { onTick(); }, 10000);
        await getConfiguration();
        manageWebSocket(() => onStart());
        ssidList = await fetchWiFiNetworks();

        peers.push(...await fetchPeers());
        onPeersChanged();

        const determinationText = document.getElementById('determination_individual');
        const determinationListener = debounce((e) => {
            console.log('determinationListener');
            const json = { server: { ...(config.server ?? {}) }};          
            json.server.room = { ...(json.server.room ?? {}) };
            json.server.room.determination = e.target.value;
              
            setConfiguration(json);
        }, 2000);
        determinationText.addEventListener('input', determinationListener);
    } );
}

function debounce(fn, delay) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  }

function preloadImage(url) {
    const img = new Image();
    img.src = url;
}

let micLevel = 0;
function loop() {
    const id = getSlideIdByIndex(splide.index);
    if(id === 'tuning' && !tuningTimeOutId && !isCold()) {
        console.log('start tuning');
        clearHistogram(histogram);
        tuningTimeOutId = setTimeout(() => {
            console.log('stop tuning');
            const peak = getGoodHistogramPeak(histogram);
            console.log('getGoodHistogramPeak ', peak);
            if(peak.frequency > 0 && peakEnergy > 0) {
                //Adjust microphone so the sphere will turn orange at this chanting volume
                micLevel = (config?.mic?.level ?? 1) * (maxWarmth/peakEnergy);
                setMic({
                    f: peak.frequency,
                    l: micLevel
                });
                // setConfiguration({
                //     "mic": {
                //         "frequency": peak.frequency,
                //         "bandwidth": narrowFilterBandwidthHz,
                //         "level": micLevel
                //     }
                // });
            }
            tuningTimeOutId = undefined;
            updateSlide(false);
            peakEnergy = 0;
        }, tuneWindowMs);
        updateSlide(false);
    }

    draw();
}

function draw() {
    if(sphereIsUp()) {
        const dw = targetWarmth - warmth;
        warmth = warmth + (dw * 0.1);
        setBackgroundFromValue(Math.min(Math.max(warmth, 0.0), maxWarmth) * (255/maxWarmth));
    }
    else {
        setBackgroundFromValue(0);
    }
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

function sphereWillReboot() {
    return rebootTimeoutId;
}
function reboot() {
    postJson('/yoyo/reboot');
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

function drawSphere(s) {
    const sphereImage = document.querySelector('#sphereImage');

    if(sphereIsUp(s))   sphereImage.src = 'img/sphere-up.png';
    else                sphereImage.src = 'img/sphere-down.png';
}

let onSphereUp = undefined, onSphereDown = undefined;
function onStatus(s) {
    if(statuscode != s) {
        const lastStatus = statuscode;
        statuscode = s;

        if(sphereIsUp(s)) {
            if(onSphereUp && typeof onSphereUp === 'function') onSphereUp();
            onSphereUp = undefined; //one time event
        }
        else {
            if(onSphereDown && typeof onSphereDown === 'function') onSphereDown();
            onSphereDown = undefined; //one time event
        }

        if(!sphereIsOnline(lastStatus) && sphereIsOnline()) onOnline();
        if(sphereIsOnline(lastStatus) && !sphereIsOnline()) onOffline();

        switch (getSlideIdByIndex(splide.index)) {
            case 'landing':  getSlideById('landing').querySelectorAll('.slide-content .row')[2].innerHTML = generateLandingText();
        }
	    drawSphere(statuscode);
    }
}

function onWebSocketConnected(v = true) {
    if(webSocketConnected !== v) {
        if(v) {
            onStatus(statuscode | 0x01 | 0x08);
            if(onWebSocketConnectedOneTime) {
                onWebSocketConnectedOneTime();
                onWebSocketConnectedOneTime = null;
            }
        }
        else {
            //if(tuningTimeOutId) activateTuning(false); 
        }
        webSocketConnected = v;
    }
}

function showCarousel(v) {
    var carousel = document.getElementById('carousel');
    carousel.style.visibility = v ? 'visible' : 'hidden';
    carousel.style['pointer-events'] = v ? 'auto' : 'none';
}

function onOnline() {
    console.log("onOnline");
    rebootTimeoutId = undefined;
    showCarousel(true);
    allowInteraction(true);
    document.querySelector('#sphereImage').style.filter = 'none';
}

function onOffline() {
    console.log("onOffline");
    onWebSocketConnected(false);
    //showCarousel(false);
    showSlide('landing');
    document.querySelector('#sphereImage').style.filter = 'invert(30%)';
    allowInteraction(false);
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
            success = postJson('/yoyo/config', config);
        }

        if(success) {
            if(post && rebootDelayMs >= 0) {
                showSlide('landing');
                allowInteraction(false);
                onSphereDown = undefined;
                rebootTimeoutId = setTimeout(function () {
                    if(sphereIsUp()) {
                        onSphereDown = function () {
                            reboot();
                        };
                    }
                    else reboot();
                }, rebootDelayMs);
            }
        }
    }

    return success;
}



function onStart() {
    console.log("onStart", config);

    //addPeerConsoleText(JSON.stringify(config.peers)+'\n');

    if(getSlideIdByIndex(splide.index) === 'landing'){
        if(sphereIsUp()) {
            setMic({r:-1});
    
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
        }
        else showSlide('landing');
    }

    document.getElementById('spherename').innerText = config?.captiveportal?.ssid ?? '';
    document.getElementById('sphereversion').innerText = config?.version ?? '';
}

async function onSlideMoved() {
    console.log('onSlideMoved');
}

async function activateTuning(v = true) { //wideListenig?
    let result = false;

    if (v && webSocketConnected) {
        //isTuning = true; // Set tuning to true - samples will be added to histogram
        filter = {
            frequency: wideFilterFrequencyHz,
            bandwidth: wideFilterBandwidthHz
        };
        setMic({f:filter.frequency, bw:filter.bandwidth, r:highMicSampleRate});
        result = true;
        //tuneSphere();
    } else {
        //isTuning = false; // Set tuning to false
        clearTimeout(tuningTimeOutId);
        tuningTimeOutId = undefined;
        setMic(); //return to defaults
    }

    return result;
}

function drawEllipse(canvas, width, height) {
    const ctx = canvas.getContext("2d");
    //ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear previous drawings

    // Draw a horizontal ellipse
    ctx.beginPath();
    ctx.ellipse(canvas.width / 2, canvas.height / 2, width / 2 , height / 2, 0, 0, 2 * Math.PI);
    ctx.strokeStyle = "gray";
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawEllipseWithImages(canvas, width, height) {
    const imgSrc = 'img/sphere-up.png';
    const numImages = 3;
    const ctx = canvas.getContext("2d");
    //ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear previous drawings

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radiusX = width/2;
    const radiusY = height/2;

    const image = new Image();
    image.src = imgSrc;
    image.onload = function() {
        const angleStep = (2 * Math.PI) / numImages; // Number of images to place along the ellipse

        for (let i = 0; i < numImages; i++) {
            const angle = i * angleStep;
            const x = centerX + radiusX * Math.cos(angle);
            const y = centerY + radiusY * Math.sin(angle);

            // Draw the image centered at (x, y)
            ctx.drawImage(image, x - 25, y - 25,50,50);
        }
    };
}

function drawRoom(container, data) {
    const template = document.getElementById("room_item_template");

    const centerX = container.clientWidth / 2;
    const centerY = container.clientHeight / 2;
    const radiusX = container.clientWidth / 2;
    const radiusY = container.clientHeight / 2;

    const keys = Object.keys(data);
    for (let i = 0; i < keys.length; i++) {
        const angle = (i * 2 * Math.PI) / keys.length;
        const x = centerX + radiusX * Math.cos(angle);
        const y = centerY + radiusY * Math.sin(angle);

        let peer = document.getElementById(keys[i]);
        if (!peer) {
            peer = template.content.cloneNode(true).firstElementChild;
            peer.id = keys[i];

            const label = peer.querySelector("span");
            label.textContent = data[keys[i]].user;

            peer.onclick = function() {
                onUserClicked(peer.id);
            };

            container.appendChild(peer);
            updatePeer(peer.id, false);
        }
        peer.style.left = `${x}px`;
        peer.style.top = `${y}px`;
    }
}

function onUserClicked(id) {
    console.log("onUserClicked: " + id);
}

function updatePeer(id, online) {
    console.log('updatePeer', id, online);

    const peer = document.getElementById(id);
    if(peer) {
        const img = peer.querySelector("img");
        if(online) img.src = 'img/sphere-up.png';
        else img.src = 'img/sphere-down.png';
    }
    else console.log('can\'t find peer ' + id);
}

function getDisplayMode() {
    const modes = ['fullscreen', 'standalone', 'minimal-ui', 'browser'];
    for (const mode of modes) {
        if (window.matchMedia(`(display-mode: ${mode})`).matches) {
            return mode;
        }
    }
    return 'unknown';
}

function getDeviceType() {
    const isPhone = /iPhone|Android.*Mobile|Windows Phone|BlackBerry|webOS/i.test(navigator.userAgent);
    return isPhone ? "phone" : "computer";
}

function generateLandingText() {
    const savedNetwork = config?.wifi?.ssid ?? '';
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;

    let text = '';

    if(!sphereWillReboot()) {
        text += 'Your sphere ';
        if(sphereIsOnline()) {
            if(!captivePortalRunning()) {
                text += 'is connected to the <span class=\'ssid\'>' + savedNetwork + '</span> WiFi network (' + getHost() +'). ';
                if(remoteConnected()) {
                    text += 'It is also connected to a Resound server (' + (config?.server?.host ?? '') + '). ';
                    text += 'Everything looks good. ';
                }
            }
            else {
                text += 'needs to be ' + (!(config?.mic?.frequency && config?.server?.host) ? 'configured and ' : '') + 'connected to a WiFi network';
                if(savedNetwork !== '') text += ', it couldn\'t find <span class=\'ssid\'>' + savedNetwork + '</span>. ';
                else text += '. ';

                if(localConnected() && !sphereIsUp()) {
                    text += 'To get started, please turn the sphere over. ';
                    onSphereUp = function() { onStart() };
                }
            }
        }
        else {
            text += 'appears to be offline. ';
            if(savedNetwork !== '') {
                text += 'It was last connected to the <span class=\'ssid\'>' + savedNetwork + '</span> WiFi network. Is the sphere plugged in? Is this '+ getDeviceType() + ' is on that network too?';
            }
        }
    }
    else {
        if(sphereIsUp()) text += 'Turn the sphere over now and it ';
        else text += 'The sphere will now';

        text += ' will try to connect to the <span class=\'ssid\'>' + savedNetwork + '</span> WiFi network. ';
        
        text += 'Make sure this '+ getDeviceType() + ' is on that network too. Please close this window. ';
        
    }
    //text += ' display-mode is ' + getDisplayMode() + '. ';
    //text += ' userAgent is ' + userAgent + '. ';
    
    return text.trim();
}

function allowInteraction(visible) {
    const arrows = document.querySelector('.splide__arrows');
    const pagination = document.querySelector('.splide__pagination');

    if (arrows) arrows.style.display = visible ? 'block' : 'none';
    if (pagination) pagination.style.display = visible ? 'flex' : 'none';
}

async function updateSlide(changed) {
    console.log('updateSlide()');

    onSphereDown = undefined;
    onSphereUp = undefined;

    //onTouchOneTime = function() { showSlide('volume'); };

    const id = getSlideIdByIndex(splide.index);

    if(changed) {
        if(id === 'tuning') {
            activateTuning(true);
        }
        else activateTuning(false);
        console.log('slide changed');
    }

    const lastRow = getSlideById(id).querySelectorAll('.slide-content .row')[2];
    switch (id) {
        case 'landing':
            lastRow.innerHTML = generateLandingText();
            break;
        case 'tuning':
            // document.getElementById('tune_button').addEventListener('click', function (e) {
            //     console.log('tune_button clicked');
            //     if(audioCtx === undefined) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            //     activateTuning(!isTuning);
            // });
            // const miclevel = document.getElementById('miclevel');
            // miclevel.disabled = !sphereIsUp();
            // miclevel.value = (config?.mic?.level ?? 1.0) * 10;
            // miclevel.addEventListener('change', function() {
            //     const v = Math.max(0.1, miclevel.value/10);
            //     setMic({l:v});
            //     config.mic.level = v;
            //     setConfiguration({mic: config.mic});
            // });
            onSphereDown = function() { updateSlide(false); console.log('TODO: tuning - onSphereDown'); };
            onSphereUp = function() { updateSlide(false); console.log('TODO: tuning - onSphereUp'); };
            
            if(!sphereIsUp()) {
                lastRow.querySelector("span").innerHTML = lastRow.querySelector(".sphere_down_text").innerHTML;
            }
            else {
                const f = config?.mic?.frequency;
                if (!tuningTimeOutId) {
                    lastRow.querySelector("span").innerHTML = 
                      'Your sphere is tuned to ' + f + 'Hz' 
                      + (getNoteName(f) ? ' (the note of ' + getNoteName(f) + ')' : '') + '.<br>'
                      + 'Start chanting NMRK to retune it.';
                  } else {
                    lastRow.querySelector("span").innerHTML = 'listening';
                  }
                //lastRow.querySelector("span").innerHTML = lastRow.querySelector(".sphere_up_text").innerHTML;
            }

            //lastRow.querySelector("span").innerHTML += ' f=' + config?.mic?.frequency + 'Hz, bw=' + config?.mic?.bandwidth + 'Hz, level=' + config?.mic?.level;
            
            break;

        case 'server':
            document.getElementById('server_name').value = config?.server?.name ?? '';
            document.getElementById('server_host').value = config?.server?.host ?? '';
            document.getElementById('server_channel').value = config?.server?.room?.channel ?? '';

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
            const roomContainer = document.getElementById('room_container');
            drawRoom(roomContainer, config.peers);
            break;

        case 'determination':
            const determinationText = document.getElementById('determination_individual');
            determinationText.value = config?.server?.room?.determination ?? '';

            const score = document.getElementById('score');
            score.textContent = config?.server?.room?.score ?? 0;

            break;

        case 'volume':
            const vollevel = document.getElementById('vollevel');
            vollevel.disabled = !sphereIsUp();
            vollevel.onchange = function() {
                onVolumeChanged(vollevel.value/100);
            };
            onVolumeChanged(config?.volume ?? 1.0, false);

            onSphereDown = function() { updateSlide(false); console.log('TODO: volume - onSphereDown'); };
            onSphereUp = function() { updateSlide(false); console.log('TODO: volume - onSphereUp'); };

            lastRow.querySelector("span").innerHTML = sphereIsUp()
                ? lastRow.querySelector(".sphere_up_text").innerHTML
                : lastRow.querySelector(".sphere_down_text").innerHTML;

            break;

        default:
            console.log("no rule for: " + id);
    }
}

function getNoteName(f) {
    let note = undefined;

    if(f > 0) {
        const A4 = 440;
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

        const semitoneOffset = Math.round(12 * Math.log2(f / A4));
        const noteIndex = (semitoneOffset + 9 + 12) % 12; // +9 to shift from A to C, +12 to handle negatives

        note = noteNames[noteIndex];
    }
    
    return note;
}

function mute(v = true) {

}

function onVolumeChanged(v, localChange = true) {
    console.log('vollevel', v, localChange);
    config.volume = v;

    if(localChange) {
        postJson('/yoyo/volume', {v:config.volume});
        console.log('localchange vollevel', v);

        if(saveConfigTimeOutId) clearTimeout(saveConfigTimeOutId);
        saveConfigTimeOutId = setTimeout(function() {
            postJson('/yoyo/config');
            saveConfigTimeOutId = undefined;
        }, 3000);
    }
    else {
        vollevel.value = v * 100; //won't cause a change event (good)
    }
}

function isWarm() {
    return warmth > (0.85 * maxWarmth);
}

function isCold() {
    return warmth < (0.15 * maxWarmth);
}

function tuneSphere() {
    //console.log('tuneSphere', tuning);

    if(false && isTuning) {
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
            
            // setConfiguration({
            //     "mic": {
            //         "frequency": peakFrequency,
            //         "bandwidth": bw
            //     }
            // });

            // const toneDurationMs = 4000;
            // playTone(filter.frequency, toneDurationMs, 0.5);
            // setTimeout(function() {
            //     showNextSlide();
            // }, toneDurationMs);
        }
    }
}

function showNextSlide() {
    splide.go('>');
}

let lastSlideIndex = -1;
function showSlide(id) {
    console.log('showSlide', id);
    if(splide) {
        const i = getSlideIndexById(id);
        lastSlideIndex = splide.index;
        if(i >= 0 && i != lastSlideIndex) {
            splide.go(i);
        }
    }
}

function showLastSlide() {
    showSlide(lastSlideIndex);
}

function getSlideById(id) {
    const track = document.querySelector('.splide__track');
    const slides = track.querySelectorAll('.splide__slide');

    for (let slide of slides) {
        if (slide.getAttribute('data-id') === id) {
            return slide;
        }
    }

    return null;
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

async function postJson(endpoint, json) {
    let success = false;

    if(endpoint) {
        try {
            let request = { method: 'POST'};
            if(!json) json = {};
            
            request.headers = { 'Accept': 'application/json; charset=utf-8', 'Content-Type': 'application/json'};
            request.body = JSON.stringify(json);
            
            const response = await fetch(endpoint, request);
            if(response.ok) {
                console.log(response);
                success = true;
            }
        }
        catch(e) {
            //console.log(e);
        }
    }

    return success;
}

async function setMic(json, save = false) {
    json['save'] = save;
    console.log('setMic ' +  JSON.stringify(json));
    postJson('/yoyo/mic', json);
}

async function setSound(json) {
    postJson('/yoyo/sound', json);
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

    const savedNetwork = config?.wifi?.ssid ?? '';

    ssidList.forEach((ssid) => {
        let option = document.createElement("option");
        option.value = ssid;
        option.textContent = ssid;
        networks.appendChild(option);
        if (ssid === savedNetwork) {
            option.selected = true;
            document.getElementById('wifi_secret').value = config?.wifi?.secret ?? '';
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

        if(json['type'] === 'debug')        parseLocalDebugMessage(json);
        else if(json['type'] === 'peer')    parseLocalPeerMessage(json);
        else if(json['type'] === 'sound')   parseLocalSoundMessage(json);
        else if(json['type'] === 'touch')   parseLocalTouchMessage(json);
        else if(json['type'] === 'gesture') parseLocalGestureMessage(json);
        else if(json['type'] === 'volume')  parseLocalVolumeMessage(json);
	else if(json['type'] === 'status');
        else parseLocalDebugMessage(json);
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
        onPeersChanged();
        updatePeer(json.id, json.arrived);
    }
}

function addPeerConsoleText(text) {
    const peerConsole = document.getElementById('peerconsole');
    if (peerConsole) {
        peerConsole.value += text;
        peerConsole.scrollTop = peerConsole.scrollHeight;
    } 
}

function parseLocalSoundMessage(json) {
    if(tuningTimeOutId) console.log('parseLocalSoundMessage' + JSON.stringify(json));

    const f = json['f'];
    const v = json['v'];
    const e = json['e'];
    
    targetWarmth = e;
    if(tuningTimeOutId) addSampleToHistogram(f,v);

    peakEnergy = tuningTimeOutId ? Math.max(e, peakEnergy) : 0;
}

function parseLocalTouchMessage(json) {
    console.log('touch', json);

    if(onTouchOneTime) {
        onTouchOneTime();
        onTouchOneTime = null;
    }
}

function parseLocalGestureMessage(json) {
    console.log('gesture', json);

    const type = json['t'];
    if(type === 'clk' || type === 'anti') {
        showSlide('volume');
    }
}

function parseLocalVolumeMessage(json) {
    console.log('volume', json);
    onVolumeChanged(json['v'], false);
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
    let frequency = -1;
    let value = -1;

    if (histogram.length > 0) {
        const { mean, sd } = calculateHistogramStats(histogram);
        const peak = findHistogramPeak(histogram);

        if (peak.value > minHistogramPeakValue && peak.value > mean + (2 * sd)) {
            const binWidth = filter.bandwidth / histogram.length;
            frequency = Math.floor(filter.frequency - (filter.bandwidth/2) + (peak.position * binWidth) + (binWidth/2));
            value = peak.value;
        }
    }

    return {frequency, value};
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