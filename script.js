let rebootTimeoutId = undefined;
let saveConfigTimeOutId = undefined;
let peerTimeOutId = {};
const peerTimeoutMs = 10000;

let webSocket;
let webSocketConnected = false;
let onWebSocketConnectedOneTime = null;
let webSocketReconnect = undefined;
let config = {};

let onSphereUp = undefined;
let onSphereDown = undefined;

const maxWifiNetworks = -1;
let ssidList = [];

let statuscode = 0x80;

const frameRate = 20;
let warmth = 0;
let targetWarmth = 0;
const maxWarmth = 5.0;
let peakEnergy = 0;

const tuningState = {
    running: false,
    goodPeakFound: false,
    timeOutId: undefined
}

const minFilterFrequencyHz = 90;
const maxFilterFrequencyHz = 250;
const wideFilterFrequencyHz = (minFilterFrequencyHz + maxFilterFrequencyHz)/2;
const wideFilterBandwidthHz = maxFilterFrequencyHz - minFilterFrequencyHz;
const narrowFilterBandwidthHz = 15;

let mic = {};

const numberOfHistogramBins = 8;
const histogram = Array(numberOfHistogramBins).fill(0);
const tuneWindowMs = 3000;

const lowMicSampleRate = 1;
const highMicSampleRate = 5;

const minHistogramPeakValue = 1.0;  //at highMicSampleRate (5 per second) and tuneWindowMs (3000)

let audioCtx = undefined;
//if(audioCtx === undefined) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

let onTouchOneTime = null;
let onMovedOneTime = null;

const peers = [];

let lastSplideIndex = -1;

const enableSwipe = true;
let deferredInstallPrompt = undefined;

async function init() {
    /*
    // start preloading images in the background (do not await)
    Promise.all([
        preloadImage("img/sphere-down.png"),
        preloadImage("img/sphere-up.png")
    ]).then(preloaded => {
        // keep references so browser doesn't GC the Image objects
        window.__preloadedImages = preloaded;
    }).catch(e => {
        console.warn('image preload failed', e);
    });
    */

    document.addEventListener("keydown", (event) => {
        if(!event.repeat) onKeyPressed(event.key, true);
    });

    document.addEventListener("keyup", (event) => {
        onKeyPressed(event.key, false);
    });

    initSphere()
}

function configureUIEvents() {
    if(enableSwipe) {
        //stop form interactions starting a swipe gesture
        document.addEventListener('focusin', function(event) {
            if(event.target?.closest && event.target.closest('.yo-yo-form')) {
                allowSwipe(false);
            }
        }, true);

        // focusout allows swipe again unless focus goes to another element inside the same form
        document.addEventListener('focusout', function(event) {
            const fromForm = event.target?.closest && event.target.closest('.yo-yo-form');
            const toInsideSameForm = event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest('.yo-yo-form') === event.target.closest('.yo-yo-form');
            if(fromForm && !toInsideSameForm) {
                allowSwipe(true);
            }
        }, true);
    }

    window.addEventListener('resize', debounce(() => {
        positionSphereImage();
        updateSlide();
    }, 300));

    const serverForm = document.getElementById('server_form');
    serverForm.addEventListener('submit', function(event) {
        event.preventDefault();
        onServerSaveEvent(new FormData(serverForm));
    });

    const wifiForm = document.getElementById('wifi_form');
    wifiForm.addEventListener('submit', function(event) {
        console.log("wifiForm.addEventListener()");
        event.preventDefault();
        onWiFiSaveEvent(new FormData(wifiForm));
    });

    const determinationText = document.getElementById('determination_individual');
    const determinationListener = debounce((event) => {
        console.log('determinationListener');
        const json = { server: { ...(config.server ?? {}) }};          
        json.server.room = { ...(json.server.room ?? {}) };
        json.server.room.determination = event.target.value;
            
        setConfiguration(json);
    }, 2000);
    determinationText.addEventListener('input', determinationListener);

    splide.on('moved', (slideIndex) => {
        if(onMovedOneTime) {
            onMovedOneTime();
            onMovedOneTime = undefined;
        }
    });

    lastSplideIndex = splide.index;
    splide.on('active', (slideElement) => {
        //prevent splide.refresh() calls causing updateSlide() events:
        if(lastSplideIndex !== splide.index) updateSlide(true);
        if(sphereIsOnline()) lastSplideIndex = splide.index;
    });
}

function hasConfiguration() {
    return(typeof config === 'object' && Object.keys(config).length > 0);
}

async function initSphere() {
    console.log('initSphere');
    //registerServiceWorker();
        
    splide = new Splide('#carousel', {
        type: 'slide',  //don't use loop it duplicates the content and screws up the forms
        perPage: 1,
        drag: false,    //also swipe
    }).mount();
    showCarousel(false);
    positionSphereImage();
    allowInteraction(false);

    console.log('configureUIEvents');
    configureUIEvents();
    console.log('configureUIEvents - done');

    console.log('getConfiguration');
    if(await getConfiguration()) {
        console.log('getConfiguration - done');
        document.getElementById('spherename').innerText = config?.captiveportal?.ssid ?? '';
        document.getElementById('sphereversion').innerText = config?.version ?? '';

        setInterval(() => { loop(); }, 1000/frameRate);
        setInterval(() => { onTick(); }, 10000);

        manageWebSocket(() => onStart());

        updateSlide(true);
    }
    else {
        console.log('getConfiguration - error');
        const rows = getSlideByID(getSlideId()).querySelectorAll('.slide-content .row');
        rows[0].innerHTML = 'error';
    }
}

function onKeyPressed(key, on) {
    if(getSlideId() === 'landing') {
        const number = Number(event.key);
        if (!isNaN(number)) {
            onUserClicked({track: number}, on);
        }
    }
}

function positionSphereImage() {
    const middleRow = document.querySelector('.middle-row');
    const backgroundImage = document.querySelector('.background-image');

    if (middleRow && backgroundImage) {
        const middleRect = middleRow.getBoundingClientRect();
        backgroundImage.style.top = `${middleRect.top + window.scrollY}px`;
        backgroundImage.style.height = `${middleRect.height}px`;
    }
}

function debounce(fn, delay) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
}

function preloadImage(url, options = {}) {
    const delay = 100 + Math.floor(Math.random() * 9900);

    return new Promise((resolve, reject) => {
        setTimeout(() => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to preload image: ${url}`));
            img.src = url;
        }, delay);
    });
}

function onTuningComplete() {
    if(tuningState.running) {
        console.log('stop tuning');
        const peak = getGoodHistogramPeak(histogram, minHistogramPeakValue * (mic?.level ?? 1));
        console.log('getGoodHistogramPeak ', peak);
        if(peak.frequency > minFilterFrequencyHz && peak.frequency < maxFilterFrequencyHz && peakEnergy > 0) {
            //Adjust microphone so the sphere will turn orange at this chanting volume
            const micLevel = (mic?.level ?? 1) * (maxWarmth/peakEnergy);
            setMic({frequency: peak.frequency, level: parseFloat(micLevel.toFixed(2))}, true);
            tuningState.goodPeakFound = true;

            updateSlide();
        }
    }
    tuningState.timeOutId = undefined;
    peakEnergy = 0;
}

function loop() {
    const id = getSlideId();
    if(id === 'tuning' && !tuningState.timeOutId && !isCold()) {
        console.log('start tuning');
        clearHistogram(histogram);
        tuningState.timeOutId = setTimeout(() => {
            onTuningComplete();
        }, tuneWindowMs);
        updateSlide();
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

            updateCount(json?.count ?? 0);
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
    const id = 'landing';
    showSlideID(id);
    const rows = getSlideByID(id).querySelectorAll('.slide-content .row');

    const savedNetwork = config?.wifi?.ssid ?? '';
    rows[0].innerHTML = 'Rebooting...';
    rows[2].innerHTML = 'Now close this window. Then make sure this ' + getDeviceType() + ' is on ' + ((savedNetwork !== '') ? 'the ' + savedNetwork : 'that')  + ' network too and scan the new QR code when the sphere has restarted.';

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

        switch (getSlideId()) {
            case 'landing':  getSlideByID('landing').querySelectorAll('.slide-content .row')[2].querySelector("span").innerHTML = generateLandingText();
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
            //if(tuningState.timeOutId) activateTuning(false); 
        }
        allowInteraction(v);
        webSocketConnected = v;
        updateSlide();
    }
}

async function onOnline() {
    console.log("onOnline", config);
    rebootTimeoutId = undefined;
    document.querySelector('#sphereImage').style.filter = 'none';
    //allowInteraction(true); //TODO: should wait for the web socket to reconnect
    
    peers.push(...await fetchPeers());
    //onPeersChanged();
    makePeers(document.getElementById('room_container'), config.peers, true);

    //return to last active page:
    showSlideIndex(lastSplideIndex);
}

async function onOffline() {
    console.log("onOffline");
    onWebSocketConnected(false);
    showSlideID('landing');
    document.querySelector('#sphereImage').style.filter = 'invert(30%)';
    allowInteraction(false);
    targetWarmth = 0;
}

async function getConfiguration(timeoutMs = 5000, attempts = 5) {
    for (let n = 0; n < attempts; n++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs); // Set timeout to abort fetch

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
                updateCount();
                setConfiguration(json, false);
                return true; //success - break out
            }
            else onStatus(0x00); // offline
        }
        catch (e) {
            onStatus(0x00); // offline
        }
        await new Promise(res => setTimeout(res, 1000));
    }

    return false;
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
                onSphereDown = undefined;
                rebootTimeoutId = setTimeout(function () {
                    if(sphereIsUp()) {
                        onSphereDown = function () {
                            drawSphere(statuscode);
                            reboot();
                        };
                    }
                    else reboot();
                }, rebootDelayMs);
                showSlideID('landing');
                allowInteraction(false);
            }
        }
    }

    return success;
}

function onStart() {
    console.log("onStart", config);

    const f = function() { showCarousel(true); };
    //allowInteraction(true);

    if(!config?.server?.host) {
        showSlideID('server', f);
    }
    else if(!config?.mic?.frequency) {
        showSlideID('tuning', f);
    }
    else if(!config?.wifi?.ssid || captivePortalRunning()) {
        showSlideID('wifi', f);
    }
    else showSlideID('landing', f);
}

async function onSlideMoved() {
    console.log('onSlideMoved');
}

async function activateTuning(v = true) {
    if (v && !tuningState.running) {
        setMic({level: (mic?.level ?? 1), frequency: wideFilterFrequencyHz, bandwidth: wideFilterBandwidthHz, rate: highMicSampleRate}, false);
        tuningState.timeOutId = undefined;
        tuningState.goodPeakFound = false;
        tuningState.running = true;
    }
    else if (!v && tuningState.running) {
        if(tuningState.timeOutId !== undefined) {
            clearTimeout(tuningState.timeOutId);
            tuningState.timeOutId = undefined;
        }
        const f = tuningState.goodPeakFound ? mic.frequency : config?.mic?.frequency;
        setMic({rate: -1, frequency: f, bandwidth: narrowFilterBandwidthHz}, true); //return to default rate
        tuningState.goodPeakFound = false;
        tuningState.running = false;
    }
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

function makePeers(container, data, layout = false) {
    if(container && data) {
        const keys = Object.keys(data);
        for (let i = 0; i < keys.length; i++) {
            const id = keys[i];
            if (!document.getElementById(id)) {
                makePeer(id, data[id].user, container);
            }
        }
    }
    if(layout) layoutPeers(container);
}

function layoutPeers(container) {
    if(container) {
        const centerX = container.clientWidth / 2;
        const centerY = container.clientHeight / 2;
        const radiusX = container.clientWidth / 2;
        const radiusY = container.clientHeight / 2;
    
        const peers = Array.from(container.children);
        for (let i = 0; i < peers.length; i++) {
            const angle = (i * 2 * Math.PI) / peers.length;
            const x = centerX + radiusX * Math.cos(angle);
            const y = centerY + radiusY * Math.sin(angle);
    
            let peer = peers[i];
            if (peer) {
                peer.style.left = `${x}px`;
                peer.style.top = `${y}px`;
            }
        }
    }
}

function makePeer(id, user, container) {
    const template = document.getElementById("room_item_template");
    let peer = template.content.cloneNode(true).firstElementChild;
    peer.id = id;

    if(user) peer.querySelector("span").textContent = user;
    updatePeer(peer, false);

    peer.addEventListener("mousedown", () => { onUserClicked({id: peer.id}); });
    peer.addEventListener("mouseup", () => { onUserClicked({id: peer.id}, false); });
    peer.addEventListener("touchstart", () => { onUserClicked({id: peer.id}); });
    peer.addEventListener("touchend", () => { onUserClicked({id: peer.id}, false); });

    if(container) container.appendChild(peer);

    return peer;
}

function onUserClicked(json, active = true) {
    json = {
        ...json,
        amplitude: 0.5,
        duration: active ? 10000 : 100,
        fade: 100
    };
    console.log('onUserClicked', json);

    postJson('/yoyo/tone', json);
}

function updatePeer(peer, online) {
    if(peer) {
        if(peerTimeOutId[peer.id]) clearTimeout(peerTimeOutId[peer.id]);

        const img = peer.querySelector("img"); 
        if(online) {
            img.src = 'img/sphere-up.png';

            peerTimeOutId[peer.id] = setTimeout(() => {
                updatePeer(peer, false);
            }, peerTimeoutMs);
        }
        else img.src = 'img/sphere-down.png';
    }
}

function isStandalone() {
    return getDisplayMode() === 'standalone';
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

function getUserAgent() {
    return(navigator.userAgent || navigator.vendor || window.opera);
}

function getDeviceType() {
    const ua = getUserAgent();

    const isPhone = /iPhone|Android.*Mobile|Windows Phone|BlackBerry|webOS/i.test(ua);
    return isPhone ? "phone" : "computer";
}

function getOS() {
    let os = "unknown";

    const ua = getUserAgent();
    if (/Android/i.test(ua))    os = "android";
    else if (/Windows NT/i.test(ua)) os = "windows";
    else if (/iPhone|iPad|iPod/i.test(ua))   os = "ios";
    else if (/Macintosh|Mac OS X/i.test(ua)) os = "macos";

    return os;
}

function getBrowser() {
    let browser = "unknown";

    const ua = getUserAgent();
    if (/crios|chrome/i.test(ua)) browser = "chrome";
    else if (/safari/i.test(ua)) browser = "safari";

    return browser;
}

function generateLandingText() {
    const savedNetwork = config?.wifi?.ssid ?? '';

    let text = '';

    if(sphereWillReboot()) {
        if(sphereIsUp()) text += 'Turn the sphere over now and it ';
        else text += 'The sphere';

        text += ' will try to connect to the <span class=\'ssid\'>' + savedNetwork + '</span> WiFi network. ';
    }
    else {
        if(sphereIsOnline()) {
            if(captivePortalRunning()) {
                text += 'Your sphere needs to be ' + (!(config?.mic?.frequency && config?.server?.host) ? 'configured and ' : '') + 'connected to a WiFi network';
                if(savedNetwork !== '') text += ', it couldn\'t connect to <span class=\'ssid\'>' + savedNetwork + '</span>. ';
                else text += '. ';

                if(localConnected() && !sphereIsUp()) {
                    text += 'To get started, please turn the sphere over. ';
                    onSphereUp = function() { onStart() };
                }
            }
            else {
                text += 'Your sphere is connect' + (localConnected() ? 'ed' : 'ing') + ' to a WiFi network';
                if(!localConnected()) {
                    text += '.<br>Please wait. ';
                }
                else if(!remoteConnected()) {
                    text += ' but not a Resound server. ';
                }
                else {
                    text += ' and a Resound server. ';
                    text += ' Everything looks good. ';
                }
            }
        }
        else {
            text += 'Your sphere appears to be offline. ';
            if(savedNetwork !== '') {
                text += 'It was last connected to the <span class=\'ssid\'>' + savedNetwork + '</span> WiFi network. Is the sphere plugged in? Is this '+ getDeviceType() + ' on that network too?';
            }
        }
    }
    
    return text.trim();
}

function generateWiFiText(networksAvailable) {
    const savedNetwork = config?.wifi?.ssid ?? '';
    let text = 'Your sphere is ';

    if(!captivePortalRunning() && sphereIsOnline()) {
        text += 'connected to the <span class=\'ssid\'>' + savedNetwork + '</span> WiFi network (' + getHost() +'). ';
    }
    else {
        text += 'not connected to a WiFi network';
        if(savedNetwork !== '') text += ', it couldn\'t connect to <span class=\'ssid\'>' + savedNetwork + '</span>. ';
        else text += '. ';

        if(networksAvailable) text += 'Select a network, enter the password and press connect. ';
 //       else text += 'Unable to see any networks to connect to. ';
    }

    return text.trim();
}

function generateServerText() {
    let text = 'Your sphere is ';
    if(captivePortalRunning()) text += 'not connected to the Internet. ';
    else {
        if(remoteConnected()){
            text += 'connected to a Resound server (' + (config?.server?.host ?? '') + '). ';
        }
        else {
            text += 'not connected to a Resound server. ';
        }
    }

    return text.trim();
}

function generateTuningText() {
    let text = '';
    const f = config?.mic?.frequency;
    const isTuned = (f !== undefined);

    if(!isTuned) {
        text += 'Your sphere isn\'t tuned.<br>';
    }
    else {
        text += 'Your sphere is tuned to a frequency of ' + f + 'Hz' 
        + (getNoteName(f) ? ' (the note of ' + getNoteName(f) + ')' : '') + '.<br>';
    }

    if(sphereIsUp()) {
        text += 'Chant NMRK to ' + (isTuned ? 're' : '') + 'tune it. ';
    }
    else {
        text += 'To get started, please turn the sphere over. ';
    }

    return text.trim();
}

function allowInteraction(v) {
    showCarouselControls(v);
    allowSwipe(v);
}

function allowSwipe(v) {
    console.log('allowSwipe', v, splide.options.drag, enableSwipe);

    v = v && enableSwipe;

    if(v !== splide.options.drag) {
        const arrows = document.querySelector('.splide__arrows');
        const pagination = document.querySelector('.splide__pagination');

        const controlVisible = (arrows.style.display === 'block' && pagination.style.display === 'flex');

        splide.options = { drag: v };
        splide.refresh();   //will reset the visibility of the controls
        showCarouselControls(controlVisible);
    }
}

function showCarousel(v) {
    var carousel = document.getElementById('carousel');
    carousel.style.visibility = v ? 'visible' : 'hidden';
    carousel.style['pointer-events'] = v ? 'auto' : 'none';
}

function showCarouselControls(v) {
    const arrows = document.querySelector('.splide__arrows');
    const pagination = document.querySelector('.splide__pagination');

    if (arrows) arrows.style.display = v ? 'block' : 'none';
    if (pagination) pagination.style.display = v ? 'flex' : 'none';
}

function updateCount(count = 0) {
    const countElement = document.getElementById('count');
    countElement.textContent = Math.max(config?.server?.room?.count ?? 0, count);
}

async function updateSlide(changed = false) {
    console.log('updateSlide()', changed, lastSplideIndex, splide.index)

    onSphereDown = undefined;
    onSphereUp = undefined;

    //onTouchOneTime = function() { showSlideID('volume'); };

    const id = getSlideId();

    if(id === 'tuning') activateTuning(sphereIsUp());
    else activateTuning(false);
    
    //only interactive once installed and the web socket is connected:
    //allowInteraction((id === 'landing') ? isStandalone() : webSocketConnected);

    const roomContainer = document.getElementById('room_container');
    roomContainer.style.display = sphereIsOnline() ? 'block' : 'none';

    if(changed) {
        postJson('/yoyo/volume', {mute: id !== 'landing'});
    }
    
    const lastRow = getSlideByID(id).querySelectorAll('.slide-content .row')[2];
    switch (id) {
        case 'landing':
            layoutPeers(roomContainer);
            if(lastRow) lastRow.querySelector('span').innerHTML = generateLandingText();
            allowInteraction(webSocketConnected);
            break;
        case 'tuning':
            onSphereDown = function() { updateSlide(); console.log('TODO: tuning - onSphereDown'); };
            onSphereUp = function() { updateSlide(); console.log('TODO: tuning - onSphereUp'); };
            
            if(lastRow) lastRow.querySelector('span').innerHTML = generateTuningText();
            
            break;

        case 'server':
            const name = document.getElementById('server_name');
            const host = document.getElementById('server_host');
            const channel = document.getElementById('server_channel');

            name.value = config?.server?.name ?? '';
            host.value = config?.server?.host ?? '';
            channel.value = config?.server?.room?.channel ?? '';

            if(lastRow) lastRow.innerHTML = generateServerText();
            break;
            
        case 'wifi':
            if(changed) {
                fetchWiFiNetworks().then(ssidList => {
                    populateWiFiForm(config, ssidList);
                    if(lastRow) lastRow.innerHTML = generateWiFiText(ssidList.length > 0);
                });
            }
            allowInteraction(webSocketConnected);
            break;

        case 'determination':
            const determinationText = document.getElementById('determination_individual');
            determinationText.value = config?.server?.room?.determination ?? '';

            break;

        case 'volume':
            const vollevel = document.getElementById('vollevel');
            vollevel.disabled = !sphereIsUp();
            vollevel.onchange = function() {
                onVolumeChanged(vollevel.value/100);
            };
            onVolumeChanged(config?.volume ?? 1.0, false);

            onSphereDown = function() { updateSlide(); console.log('TODO: volume - onSphereDown'); };
            onSphereUp = function() { updateSlide(); console.log('TODO: volume - onSphereUp'); };

            if(lastRow) lastRow.querySelector('span').innerHTML = sphereIsUp()
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

function showNextSlide() {
    splide.go('>');
}

function showSlideID(id, onMoved = undefined) {
    showSlideIndex(getSlideIndexByID(id), onMoved);
}

function showSlideIndex(i, onMoved = undefined) {
    if(splide) {
        if(i >= 0) {
            if(i != splide.index) {
                onMovedOneTime = onMoved;
                splide.go(i);
            }
            else if(onMoved) onMoved();
        }
    }
}

function getSlideByID(id) {
    const track = document.querySelector('.splide__track');
    const slides = track.querySelectorAll('.splide__slide');

    for (let slide of slides) {
        if (slide.getAttribute('data-id') === id) {
            return slide;
        }
    }

    return null;
}

function getSlideIndexByID(id) {
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

function getSlideId() {
    let id = null;
    try {
        id = getSlideIdByIndex(splide.index);   
    }
    catch(e) {}
    return(id);
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

async function setMic(options, save = false) {
    Object.assign(mic, options);

    //Constrain the bandwidth to fit within limits:
    if(mic.frequency &&  mic.bandwidth) {
        const f0 = Math.max(mic.frequency - (mic.bandwidth/2), minFilterFrequencyHz);
        const f1 = Math.min(mic.frequency + (mic.bandwidth/2), maxFilterFrequencyHz);
        mic.bandwidth = Math.max(2 * Math.min(mic.frequency - f0, f1 - mic.frequency), narrowFilterBandwidthHz);    //make sure bandwidth doesn't get too tight
    
        if(save) {
            config.mic = config.mic ?? {};
            config.mic.frequency = mic?.frequency;
            config.mic.bandwidth = mic?.bandwidth;
            config.mic.level = mic?.level;
        }
        postJson('/yoyo/mic', {...mic, save: save});
    }
    console.log('setMic', mic, save);
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

    if(maxWifiNetworks >= 0) ssidList = ssidList.slice(0, maxWifiNetworks); // Limit the number of networks
    
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
        networks.removeAttribute("disabled");
        document.getElementById('wifi_secret').removeAttribute("disabled");
        document.getElementById('wifi_button').removeAttribute("disabled");
    }
}

async function onWiFiSaveEvent(data) {
    console.log("onWiFiSaveEvent", data);
    const ssid = data.get('ssid');
    const secret = data.get('secret');

    if(ssid && ssid.length > 0) {
        setConfiguration({
            "wifi": {
                "ssid": ssid,
                "secret": secret,
            },
        }, true, 1000);
    }
}

async function onServerSaveEvent(data) {
    console.log("onServerSaveEvent", data);

    setConfiguration({
        "server": {
            "name": data.get('name'),
            "host": data.get('host'),
            "room": {
                "channel": data.get('channel')
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

// function onPeersChanged() {
//     addPeerConsoleText('[');
//     peers.forEach(function(id) {
//         addPeerConsoleText(id + '(' + config?.peers[id]?.user + '),');
//     });
//     addPeerConsoleText(']\n');
// }

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
        //onPeersChanged();
        let peer = document.getElementById(json.id);
        if (!peer) {
            const container = document.getElementById('room_container');
            peer = makePeer(json.id, undefined, container);
            layoutPeers(container);
        }
        updatePeer(peer, json.arrived);
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
    if(tuningState.timeOutId) console.log('parseLocalSoundMessage' + JSON.stringify(json));

    const f = json['f'];
    const v = json['v'];
    const e = json['e'];
    
    targetWarmth = e;
    if(tuningState.timeOutId) addSampleToHistogram(f,v);

    peakEnergy = tuningState.timeOutId ? Math.max(e, peakEnergy) : 0;
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
        showSlideID('volume');
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
    const fl = mic.frequency - (mic.bandwidth/2);
    const fh = mic.frequency + (mic.bandwidth/2);
    const binSize = mic.bandwidth/histogram.length;

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

function getGoodHistogramPeak(histogram, threshold) {
    let frequency = -1;
    let value = -1;

    if (histogram.length > 0) {
        const { mean, sd } = calculateHistogramStats(histogram);
        const peak = findHistogramPeak(histogram);

        if (peak.value > threshold && peak.value > mean + (2 * sd)) {
            console.log('---peak.value---', peak.value);

            const binWidth = mic.bandwidth / histogram.length;
            frequency = Math.floor(mic.frequency - (mic.bandwidth/2) + (peak.position * binWidth) + (binWidth/2));
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

document.addEventListener( 'DOMContentLoaded', async function () {
    init();
});

async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
        // register relative to the current document so the browser infers an appropriate scope
        const reg = await navigator.serviceWorker.register('./service-worker.js');
        console.log('service worker registered', reg);
    } catch (err) {
        console.error('service worker registration failed', err);
    }
}