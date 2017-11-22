import GIF from './myGif';
import GIFE from 'gif.js';
import QRCodeModel from './QRCodeModel';
import { QRErrorCorrectLevel, QRUtil } from './constant';

function _onMakeImage() {
  this._elImage.src = this._elCanvas.toDataURL('image/png');
  this._elImage.style.display = 'block';
  this._elCanvas.style.display = 'none';
}

function _safeSetDataURI(fSuccess, fFail) {
  var self = this;
  self._fFail = fFail;
  self._fSuccess = fSuccess;

  // Check it just once
  if (self._bSupportDataURI === null) {
    var el = document.createElement('img');
    var fOnError = function() {
      self._bSupportDataURI = false;

      if (self._fFail) {
        self._fFail();
      }
    };
    var fOnSuccess = function() {
      self._bSupportDataURI = true;

      if (self._fSuccess) {
        self._fSuccess();
      }
    };

    el.onabort = fOnError;
    el.onerror = fOnError;
    el.onload = fOnSuccess;
    el.src =
      'data:image/gif;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg=='; // the Image contains 1px data.
  } else if (self._bSupportDataURI === true && self._fSuccess) {
    self._fSuccess();
  } else if (self._bSupportDataURI === false && self._fFail) {
    self._fFail();
  }
}

function Drawing(htOption) {
  this._bIsPainted = false;
  this._htOption = htOption;
  this._elCanvas = document.createElement('canvas');
  this._elCanvas.width = htOption.size;
  this._elCanvas.height = htOption.size;
  this._oContext = this._elCanvas.getContext('2d');
  this._bIsPainted = false;
  this._elImage = document.createElement('img');
  this._elImage.alt = 'Scan me!';
  this._elImage.style.display = 'none';
  this._bSupportDataURI = null;
  this._callback = htOption.callback;
  this._bindElement = htOption.bindElement;
}

Drawing.prototype.draw = function(oQRCode) {
  var _elImage = this._elImage;
  var _tCanvas = document.createElement('canvas');
  var _oContext = _tCanvas.getContext('2d');
  // var _oContext = this._oContext;
  var _htOption = this._htOption;
  var nCount = oQRCode.getModuleCount();
  var rawSize = _htOption.size;
  var rawMargin = _htOption.margin;
  if (rawMargin < 0 || rawMargin * 2 >= rawSize) {
    rawMargin = 0;
  }

  var margin = Math.ceil(rawMargin);
  var rawViewportSize = rawSize - 2 * rawMargin;
  var whiteMargin = _htOption.whiteMargin;
  var backgroundDimming = _htOption.backgroundDimming;
  var nSize = Math.ceil(rawViewportSize / nCount);
  var viewportSize = nSize * nCount;
  var size = viewportSize + 2 * margin;
  var gifBackground;
  var gifFrames;

  _tCanvas.width = size;
  _tCanvas.height = size;

  var dotScale = _htOption.dotScale;
  _elImage.style.display = 'none';
  this.clear();

  if (dotScale <= 0 || dotScale > 1) {
    throw new Error('Scale should be in range (0, 1).');
  }

  // Leave room for margin
  _oContext.save();
  _oContext.translate(margin, margin);

  var _bkgCanvas = document.createElement('canvas');
  _bkgCanvas.width = size;
  _bkgCanvas.height = size;
  var _bContext = _bkgCanvas.getContext('2d');
  var _maskCanvas;
  var _mContext;

  if (_htOption.gifBackground !== undefined) {
    var gif = new GIF(_htOption.gifBackground);
    // console.log(_htOption.gifBackground);
    // console.log(gif);
    if (!gif.raw.hasImages) {
      throw new Error('An invalid gif has been selected as the background.');
    }
    gifBackground = gif;
    gifFrames = gif.decompressFrames(true);
    // console.log(gifFrames);
    if (_htOption.autoColor) {
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (var i = 0; i < gifFrames[0].colorTable.length; i++) {
        var c = gifFrames[0].colorTable[i];
        if (c[0] > 200 || c[1] > 200 || c[2] > 200) continue;
        if (c[0] === 0 && c[1] === 0 && c[2] === 0) continue;
        count++;
        r += c[0];
        g += c[1];
        b += c[2];
      }

      r = ~~(r / count);
      g = ~~(g / count);
      b = ~~(b / count);
      // console.log("rgb(" + r + ", " + g + ", " + b + ")");
      _htOption.colorDark = 'rgb(' + r + ', ' + g + ', ' + b + ')';
    }
  } else if (_htOption.backgroundImage !== undefined) {
    if (_htOption.autoColor) {
      var avgRGB = getAverageRGB(_htOption.backgroundImage);
      _htOption.colorDark =
        'rgb(' + avgRGB.r + ', ' + avgRGB.g + ', ' + avgRGB.b + ')';
    }

    if (_htOption.maskedDots) {
      _maskCanvas = document.createElement('canvas');
      _maskCanvas.width = size;
      _maskCanvas.height = size;
      _mContext = _maskCanvas.getContext('2d');
      /*
                 _mContext.drawImage(_htOption.backgroundImage,
                 0, 0, _htOption.backgroundImage.width, _htOption.backgroundImage.height,
                 whiteMargin ? 0 : -margin, whiteMargin ? 0 : -margin, whiteMargin ? viewportSize : size, whiteMargin ? viewportSize : size);
                 */
      _mContext.drawImage(
        _htOption.backgroundImage,
        0,
        0,
        _htOption.backgroundImage.width,
        _htOption.backgroundImage.height,
        0,
        0,
        size,
        size
      );

      _bContext.rect(0, 0, size, size);
      _bContext.fillStyle = '#ffffff';
      _bContext.fill();
    } else {
      /*
                 _bContext.drawImage(_htOption.backgroundImage,
                 0, 0, _htOption.backgroundImage.width, _htOption.backgroundImage.height,
                 whiteMargin ? 0 : -margin, whiteMargin ? 0 : -margin, whiteMargin ? viewportSize : size, whiteMargin ? viewportSize : size);
                 */
      _bContext.drawImage(
        _htOption.backgroundImage,
        0,
        0,
        _htOption.backgroundImage.width,
        _htOption.backgroundImage.height,
        0,
        0,
        size,
        size
      );
      _bContext.rect(0, 0, size, size);
      _bContext.fillStyle = backgroundDimming;
      _bContext.fill();
    }
  } else {
    _bContext.rect(0, 0, size, size);
    _bContext.fillStyle = '#ffffff';
    _bContext.fill();
  }

  if (_htOption.binarize) {
    _htOption.colorDark = '#000000';
    _htOption.colorLight = '#FFFFFF';
  }

  var agnPatternCenter = QRUtil.getPatternPosition(oQRCode.typeNumber);

  var xyOffset = (1 - dotScale) * 0.5;
  for (let row = 0; row < nCount; row++) {
    for (let col = 0; col < nCount; col++) {
      var bIsDark = oQRCode.isDark(row, col);

      // var isBlkPosCtr = ((col < 8 && (row < 8 || row >= nCount - 8)) || (col >= nCount - 8 && row < 8) || (col < nCount - 4 && col >= nCount - 4 - 5 && row < nCount - 4 && row >= nCount - 4 - 5));
      var isBlkPosCtr =
        (col < 8 && (row < 8 || row >= nCount - 8)) ||
        (col >= nCount - 8 && row < 8);

      var bProtected = row === 6 || col === 6 || isBlkPosCtr;

      for (let i = 0; i < agnPatternCenter.length - 1; i++) {
        bProtected =
          bProtected ||
          (row >= agnPatternCenter[i] - 2 &&
            row <= agnPatternCenter[i] + 2 &&
            col >= agnPatternCenter[i] - 2 &&
            col <= agnPatternCenter[i] + 2);
      }

      let nLeft = col * nSize + (bProtected ? 0 : xyOffset * nSize);
      let nTop = row * nSize + (bProtected ? 0 : xyOffset * nSize);
      _oContext.strokeStyle = bIsDark
        ? _htOption.colorDark
        : _htOption.colorLight;
      _oContext.lineWidth = 0.5;
      _oContext.fillStyle = bIsDark
        ? _htOption.colorDark
        : 'rgba(255, 255, 255, 0.6)'; // _htOption.colorLight;
      if (agnPatternCenter.length === 0) {
        // if align pattern list is empty, then it means that we don't need to leave room for the align patterns
        if (!bProtected) {
          _fillRectWithMask(
            _oContext,
            nLeft,
            nTop,
            (bProtected ? (isBlkPosCtr ? 1 : 1) : dotScale) * nSize,
            (bProtected ? (isBlkPosCtr ? 1 : 1) : dotScale) * nSize,
            _maskCanvas,
            bIsDark
          );
        }
      } else {
        var inAgnRange =
          col < nCount - 4 &&
          col >= nCount - 4 - 5 &&
          row < nCount - 4 &&
          row >= nCount - 4 - 5;
        if (!bProtected && !inAgnRange) {
          _fillRectWithMask(
            _oContext,
            nLeft,
            nTop,
            (bProtected ? (isBlkPosCtr ? 1 : 1) : dotScale) * nSize,
            (bProtected ? (isBlkPosCtr ? 1 : 1) : dotScale) * nSize,
            _maskCanvas,
            bIsDark
          );
        }
      }
    }
  }

  // Draw POSITION protectors
  var protectorStyle = 'rgba(255, 255, 255, 0.6)';
  _oContext.fillStyle = protectorStyle;
  _oContext.fillRect(0, 0, 8 * nSize, 8 * nSize);
  _oContext.fillRect(0, (nCount - 8) * nSize, 8 * nSize, 8 * nSize);
  _oContext.fillRect((nCount - 8) * nSize, 0, 8 * nSize, 8 * nSize);
  _oContext.fillRect(8 * nSize, 6 * nSize, (nCount - 8 - 8) * nSize, nSize);
  _oContext.fillRect(6 * nSize, 8 * nSize, nSize, (nCount - 8 - 8) * nSize);

  // Draw ALIGN protectors
  var edgeCenter = agnPatternCenter[agnPatternCenter.length - 1];
  for (let i = 0; i < agnPatternCenter.length; i++) {
    for (let j = 0; j < agnPatternCenter.length; j++) {
      let agnX = agnPatternCenter[j];
      let agnY = agnPatternCenter[i];
      if (agnX === 6 && (agnY === 6 || agnY === edgeCenter)) {
        continue;
      } else if (agnY === 6 && (agnX === 6 || agnX === edgeCenter)) {
        continue;
      } else if (
        agnX !== 6 &&
        agnX !== edgeCenter &&
        agnY !== 6 &&
        agnY !== edgeCenter
      ) {
        _drawAlignProtector(_oContext, agnX, agnY, nSize, nSize);
      } else {
        _drawAlignProtector(_oContext, agnX, agnY, nSize, nSize);
      }
      // console.log("agnX=" + agnX + ", agnY=" + agnX);
    }
  }

  // Draw POSITION patterns
  _oContext.fillStyle = _htOption.colorDark;
  _oContext.fillRect(0, 0, 7 * nSize, nSize);
  _oContext.fillRect((nCount - 7) * nSize, 0, 7 * nSize, nSize);
  _oContext.fillRect(0, 6 * nSize, 7 * nSize, nSize);
  _oContext.fillRect((nCount - 7) * nSize, 6 * nSize, 7 * nSize, nSize);
  _oContext.fillRect(0, (nCount - 7) * nSize, 7 * nSize, nSize);
  _oContext.fillRect(0, (nCount - 7 + 6) * nSize, 7 * nSize, nSize);
  _oContext.fillRect(0, 0, nSize, 7 * nSize);
  _oContext.fillRect(6 * nSize, 0, nSize, 7 * nSize);
  _oContext.fillRect((nCount - 7) * nSize, 0, nSize, 7 * nSize);
  _oContext.fillRect((nCount - 7 + 6) * nSize, 0, nSize, 7 * nSize);
  _oContext.fillRect(0, (nCount - 7) * nSize, nSize, 7 * nSize);
  _oContext.fillRect(6 * nSize, (nCount - 7) * nSize, nSize, 7 * nSize);

  _oContext.fillRect(2 * nSize, 2 * nSize, 3 * nSize, 3 * nSize);
  _oContext.fillRect((nCount - 7 + 2) * nSize, 2 * nSize, 3 * nSize, 3 * nSize);
  _oContext.fillRect(2 * nSize, (nCount - 7 + 2) * nSize, 3 * nSize, 3 * nSize);

  for (let i = 0; i < nCount - 8; i += 2) {
    _oContext.fillRect((8 + i) * nSize, 6 * nSize, nSize, nSize);
    _oContext.fillRect(6 * nSize, (8 + i) * nSize, nSize, nSize);
  }
  for (let i = 0; i < agnPatternCenter.length; i++) {
    for (let j = 0; j < agnPatternCenter.length; j++) {
      let agnX = agnPatternCenter[j];
      let agnY = agnPatternCenter[i];
      if (agnX === 6 && (agnY === 6 || agnY === edgeCenter)) {
        continue;
      } else if (agnY === 6 && (agnX === 6 || agnX === edgeCenter)) {
        continue;
      } else if (
        agnX !== 6 &&
        agnX !== edgeCenter &&
        agnY !== 6 &&
        agnY !== edgeCenter
      ) {
        _oContext.fillStyle = 'rgba(0, 0, 0, .2)';
        _drawAlign(_oContext, agnX, agnY, nSize, nSize);
      } else {
        _oContext.fillStyle = _htOption.colorDark;
        _drawAlign(_oContext, agnX, agnY, nSize, nSize);
      }
    }
  }

  // Fill the margin
  if (whiteMargin) {
    _oContext.fillStyle = '#FFFFFF';
    _oContext.fillRect(-margin, -margin, size, margin);
    _oContext.fillRect(-margin, viewportSize, size, margin);
    _oContext.fillRect(viewportSize, -margin, margin, size);
    _oContext.fillRect(-margin, -margin, margin, size);
  }

  if (_htOption.logoImage !== undefined) {
    let logoScale = _htOption.logoScale;
    let logoMargin = _htOption.logoMargin;
    let logoCornerRadius = _htOption.logoCornerRadius;
    if (logoScale <= 0 || logoScale >= 1.0) {
      logoScale = 0.2;
    }
    if (logoMargin < 0) {
      logoMargin = 0;
    }
    if (logoCornerRadius < 0) {
      logoCornerRadius = 0;
    }

    _oContext.restore();

    let logoSize = viewportSize * logoScale;
    let x = 0.5 * (size - logoSize);
    let y = x;

    _oContext.fillStyle = '#FFFFFF';
    _oContext.save();
    _prepareRoundedCornerClip(
      _oContext,
      x - logoMargin,
      y - logoMargin,
      logoSize + 2 * logoMargin,
      logoSize + 2 * logoMargin,
      logoCornerRadius
    );
    _oContext.clip();
    _oContext.fill();
    _oContext.restore();

    _oContext.save();
    _prepareRoundedCornerClip(
      _oContext,
      x,
      y,
      logoSize,
      logoSize,
      logoCornerRadius
    );
    _oContext.clip();
    _oContext.drawImage(_htOption.logoImage, x, y, logoSize, logoSize);
    _oContext.restore();
  }

  if (gifBackground === undefined) {
    // Swap and merge the foreground and the background
    _bContext.drawImage(_tCanvas, 0, 0, size, size);
    _oContext.drawImage(_bkgCanvas, -margin, -margin, size, size);

    // Binarize the final image
    if (_htOption.binarize) {
      var pixels = _oContext.getImageData(0, 0, size, size);
      var threshold = 128;
      if (
        parseInt(_htOption.binarizeThreshold) > 0 &&
        parseInt(_htOption.binarizeThreshold) < 255
      ) {
        threshold = parseInt(_htOption.binarizeThreshold);
      }
      for (let i = 0; i < pixels.data.length; i += 4) {
        // rgb in [0, 255]
        var R = pixels.data[i];
        var G = pixels.data[i + 1];
        var B = pixels.data[i + 2];
        var sum = _greyscale(R, G, B);
        if (sum > threshold) {
          pixels.data[i] = 255;
          pixels.data[i + 1] = 255;
          pixels.data[i + 2] = 255;
        } else {
          pixels.data[i] = 0;
          pixels.data[i + 1] = 0;
          pixels.data[i + 2] = 0;
        }
      }
      _oContext.putImageData(pixels, 0, 0);
    }

    // Scale the final image
    let _fCanvas = document.createElement('canvas');
    let _fContext = _fCanvas.getContext('2d');
    _fCanvas.width = rawSize;
    _fCanvas.height = rawSize;
    _fContext.drawImage(_tCanvas, 0, 0, rawSize, rawSize);
    this._elCanvas = _fCanvas;

    // Painting work completed
    this._bIsPainted = true;
    if (this._callback !== undefined) {
      this._callback(this._elCanvas.toDataURL());
    }
    if (this._bindElement !== undefined) {
      try {
        var el = document.getElementById(this._bindElement);
        if (el.nodeName === 'IMG') {
          el.src = this._elCanvas.toDataURL();
        } else {
          var elStyle = el.style;
          elStyle['background-image'] =
            'url(' + this._elCanvas.toDataURL() + ')';
          elStyle['background-size'] = 'contain';
          elStyle['background-repeat'] = 'no-repeat';
        }
      } catch (e) {
        console.error(e);
      }
    }
  } else {
    var gifOutput;

    // Reuse in order to apply the patch
    var rawBkg;
    var hRawBkg;

    var patchCanvas = document.createElement('canvas');
    var hPatchCanvas = patchCanvas.getContext('2d');
    var patchData;

    gifFrames.forEach(function(frame) {
      // console.log(frame);
      if (gifOutput === undefined) {
        gifOutput = new GIFE({
          workers: 4,
          quality: 10,
          width: rawSize,
          height: rawSize
        });
      }

      if (rawBkg === undefined) {
        rawBkg = document.createElement('canvas');
        hRawBkg = rawBkg.getContext('2d');
        rawBkg.width = frame.dims.width;
        rawBkg.height = frame.dims.height;
        hRawBkg.rect(0, 0, rawBkg.width, rawBkg.height);
        hRawBkg.fillStyle = '#ffffff';
        hRawBkg.fill();
        // console.log(rawBkg);
      }

      if (
        !patchData ||
        frame.dims.width !== patchCanvas.width ||
        frame.dims.height !== patchCanvas.height
      ) {
        patchCanvas.width = frame.dims.width;
        patchCanvas.height = frame.dims.height;
        patchData = hPatchCanvas.createImageData(
          frame.dims.width,
          frame.dims.height
        );
      }

      patchData.data.set(frame.patch);
      hPatchCanvas.putImageData(patchData, 0, 0);

      hRawBkg.drawImage(patchCanvas, frame.dims.left, frame.dims.top);

      var stdCanvas = document.createElement('canvas');
      stdCanvas.width = size;
      stdCanvas.height = size;
      var hStdCanvas = stdCanvas.getContext('2d');

      hStdCanvas.drawImage(rawBkg, 0, 0, size, size);
      hStdCanvas.drawImage(_tCanvas, 0, 0, size, size);

      // Scale the final image
      var _fCanvas = document.createElement('canvas');
      var _fContext = _fCanvas.getContext('2d');
      _fCanvas.width = rawSize;
      _fCanvas.height = rawSize;
      _fContext.drawImage(stdCanvas, 0, 0, rawSize, rawSize);
      // console.log(_fContext);
      gifOutput.addFrame(_fContext, { copy: true, delay: frame.delay });
    });

    if (gifOutput === undefined) {
      throw new Error('No frames.');
    }
    var ref = this;
    gifOutput.on('finished', function(blob) {
      // Painting work completed
      var r = new window.FileReader();
      r.onload = function(e) {
        var data = e.target.result;
        ref._bIsPainted = true;
        if (ref._callback !== undefined) {
          ref._callback(data);
        }
        if (ref._bindElement !== undefined) {
          try {
            var el = document.getElementById(ref._bindElement);
            if (el.nodeName === 'IMG') {
              el.src = data;
            } else {
              var elStyle = el.style;
              elStyle['background-image'] = 'url(' + data + ')';
              elStyle['background-size'] = 'contain';
              elStyle['background-repeat'] = 'no-repeat';
            }
          } catch (e) {
            console.error(e);
          }
        }
      };
      r.readAsDataURL(blob);
    });

    gifOutput.render();
  }
};

Drawing.prototype.makeImage = function() {
  if (this._bIsPainted) {
    _safeSetDataURI.call(this, _onMakeImage);
  }
};

Drawing.prototype.isPainted = function() {
  return this._bIsPainted;
};

Drawing.prototype.clear = function() {
  this._oContext.clearRect(0, 0, this._elCanvas.width, this._elCanvas.height);
  this._bIsPainted = false;
};

Drawing.prototype.round = function(nNumber) {
  if (!nNumber) {
    return nNumber;
  }

  return Math.floor(nNumber * 1000) / 1000;
};

function _prepareRoundedCornerClip(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function _greyscale(r, g, b) {
  return 0.3 * r + 0.59 * b + 0.11 * b;
}

function _fillRectWithMask(canvas, x, y, w, h, maskSrc, bDark) {
  // console.log("maskSrc=" + maskSrc);
  if (maskSrc === undefined) {
    canvas.fillRect(x, y, w, h);
  } else {
    canvas.drawImage(maskSrc, x, y, w, h, x, y, w, h);
    var fill_ = canvas.fillStyle;
    canvas.fillStyle = bDark ? 'rgba(0, 0, 0, .5)' : 'rgba(255, 255, 255, .7)';
    canvas.fillRect(x, y, w, h);
    canvas.fillStyle = fill_;
  }
}

function _drawAlignProtector(context, centerX, centerY, nWidth, nHeight) {
  context.clearRect(
    (centerX - 2) * nWidth,
    (centerY - 2) * nHeight,
    5 * nWidth,
    5 * nHeight
  );
  context.fillRect(
    (centerX - 2) * nWidth,
    (centerY - 2) * nHeight,
    5 * nWidth,
    5 * nHeight
  );
}

function _drawAlign(context, centerX, centerY, nWidth, nHeight) {
  context.fillRect(
    (centerX - 2) * nWidth,
    (centerY - 2) * nHeight,
    nWidth,
    4 * nHeight
  );
  context.fillRect(
    (centerX + 2) * nWidth,
    (centerY - 2 + 1) * nHeight,
    nWidth,
    4 * nHeight
  );
  context.fillRect(
    (centerX - 2 + 1) * nWidth,
    (centerY - 2) * nHeight,
    4 * nWidth,
    nHeight
  );
  context.fillRect(
    (centerX - 2) * nWidth,
    (centerY + 2) * nHeight,
    4 * nWidth,
    nHeight
  );
  context.fillRect(centerX * nWidth, centerY * nHeight, nWidth, nHeight);
}

const AwesomeQRCode = function() {};

AwesomeQRCode.prototype.create = function(vOption) {
  this._htOption = {
    size: 800,
    margin: 20,
    typeNumber: 4,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRErrorCorrectLevel.M,
    backgroundImage: undefined,
    backgroundDimming: 'rgba(0,0,0,0)',
    logoImage: undefined,
    logoScale: 0.2,
    logoMargin: 6,
    logoCornerRadius: 8,
    whiteMargin: true,
    dotScale: 0.35,
    maskedDots: false,
    autoColor: true,
    binarize: false,
    binarizeThreshold: 128,
    gifBackground: undefined,
    callback: undefined,
    bindElement: undefined
  };

  if (typeof vOption === 'string') {
    vOption = {
      text: vOption
    };
  }

  if (vOption) {
    for (var i in vOption) {
      this._htOption[i] = vOption[i];
    }
  }

  this._oQRCode = null;
  this._oDrawing = new Drawing(this._htOption);

  if (this._htOption.text) {
    this.makeCode(this._htOption.text);
  }
};

AwesomeQRCode.prototype.makeCode = function(sText) {
  this._oQRCode = new QRCodeModel(-1, this._htOption.correctLevel);
  this._oQRCode.addData(sText);
  this._oQRCode.make();
  this._oDrawing.draw(this._oQRCode);
  this.makeImage();
};

AwesomeQRCode.prototype.makeImage = function() {
  if (typeof this._oDrawing.makeImage === 'function') {
    this._oDrawing.makeImage();
  }
};

AwesomeQRCode.prototype.clear = function() {
  this._oDrawing.clear();
};

AwesomeQRCode.CorrectLevel = QRErrorCorrectLevel;

function getAverageRGB(imgEl) {
  const blockSize = 5;
  const defaultRGB = {
    r: 0,
    g: 0,
    b: 0
  };
  const canvas = document.createElement('canvas');
  const context = canvas.getContext && canvas.getContext('2d');
  let data;
  let width;
  let height;
  let i = -4;
  let length;
  let rgb = {
    r: 0,
    g: 0,
    b: 0
  };
  let count = 0;

  if (!context) {
    return defaultRGB;
  }

  height = canvas.height =
    imgEl.naturalHeight || imgEl.offsetHeight || imgEl.height;
  width = canvas.width = imgEl.naturalWidth || imgEl.offsetWidth || imgEl.width;

  context.drawImage(imgEl, 0, 0);

  try {
    data = context.getImageData(0, 0, width, height);
  } catch (e) {
    return defaultRGB;
  }

  length = data.data.length;

  while ((i += blockSize * 4) < length) {
    if (
      data.data[i] > 200 ||
      data.data[i + 1] > 200 ||
      data.data[i + 2] > 200
    ) {
      continue;
    }
    ++count;
    rgb.r += data.data[i];
    rgb.g += data.data[i + 1];
    rgb.b += data.data[i + 2];
  }

  rgb.r = ~~(rgb.r / count);
  rgb.g = ~~(rgb.g / count);
  rgb.b = ~~(rgb.b / count);

  return rgb;
}

export default AwesomeQRCode;
