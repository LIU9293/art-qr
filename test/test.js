const assert = require('assert');
const ArtQR = require('../dist/bundle.cjs.js');

describe('Art QR main library', function() {
  it('Art QR should generate data uri start with -data:image-', function() {
    new ArtQR().create({
      text: 'https://baidu.com',
      size: 200,
      margin: 20,
      colorDark: '#000000',
      colorLight: '#FFFFFF',
      backgroundImage: undefined,
      backgroundDimming: 'rgba(0,0,0,0)',
      logoImage: undefined,
      logoScale: 0.2,
      logoMargin: 0,
      logoCornerRadius: 8,
      whiteMargin: true,
      dotScale: 0.35,
      autoColor: true,
      binarize: false,
      binarizeThreshold: 128,
      callback: function(dataURI) {
        assert.equal(dataURI.substr(0, 10), 'data:image');
      }
    });
  });
});
