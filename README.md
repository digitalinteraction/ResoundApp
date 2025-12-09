<p align="center"><img src="/img/resound_logo.svg" width="200" alt="Resound Logo"></p>

# Resound App

This web-based app is hosted on the Resound Sphere and is a submodule of the [Resound](https://github.com/digitalinteraction/Resound) project. It is also hosted on [GitHub Pages](https://digitalinteraction.github.io/ResoundApp/package.html) and tested via the console.

The locally hosted app manages connection to WiFi, configuation of the sphere and displays the current state of the device and connected peers. It is intended to be installed as a Progressive Web App (PWA) on a smart phone.

---

## Features

* **WiFi Configuration**
  Connect the Sphere to a local WiFi network using a simple dropdown and password form.

* **Server Connection**
  Link the Sphere to a Resound server and join a specific channel/community.

* **Voice Tuning**
  Tune the Sphere to your voice.

* **Volume Adjustment**
  Adjust volume using a slider or by interacting with the Sphere itself.

* **Community**
  See other spheres in your community.

* **Determination**
  Set the determination of your community.

---

## Project Structure

```
.
├── index.html            # Local HTML interface
├── img/                  # Images and icons (e.g., logo, sphere image)
├── splide/               # Splide.js carousel library files
├── style.css             # Main stylesheet
├── script.js             # Main JavaScript logic
├── app.webmanifest       # PWA manifest
└── service-worker.js     # Service Worker for offline support
```

---

## Technologies Used

* **HTML5 / CSS3 / JavaScript**
* [Splide.js](https://splidejs.com/) — lightweight slider/carousel library
* **Service Workers** — for offline support
* **PWA Manifest** — for app-like experience on mobile

---

## License

© 2025 Newcastle University. This project is licensed under the [MIT License](LICENSE.txt).