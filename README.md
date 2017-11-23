<img src="https://raw.githubusercontent.com/LIU9293/art-qr/master/qr.jpg" align="right" />

# art-qr

> Pure JavaScript library to generate beautiful QR code on websites

![travis](https://travis-ci.org/LIU9293/art-qr.svg?branch=master)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square)](https://github.com/prettier/prettier)
[![npm version](https://badge.fury.io/js/art-qr.svg)](https://badge.fury.io/js/art-qr)

### Installation
```
yarn add art-qr
/* or use npm if you prefer*/
npm install art-qr -S
```

### Usgae

All options can see [here](https://github.com/SumiMakito/Awesome-qr.js#options).
Upon of the original version, we provide `download` method, see the code as example:

```js
import ArtQR from 'art-qr';

// create something you can access to store the instance if you want
let MyQRInstance;

const img = new Image();
img.crossOrigin = "Anonymous";
img.src = YOUR_IMAGE_URL;

img.onload = () => {
  MyQRInstance = new ArtQR().create({
    text: YOUR_URL_OR_TEXT,
    size: 300,
    margin: 10,
    backgroundImage: img,
    callback: function (dataUri) {
      console.log(dataUri)
    },
    bindElement: 'qr' // id of <img /> in real dom
  });
}

// download the QR code is easy
MyQRInstance.download()
```

### Credit
The project is a fork of [Awesome-qr.js](https://github.com/SumiMakito/Awesome-qr.js), and changed
the build process/code style for esay use.
