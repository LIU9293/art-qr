(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
	typeof define === 'function' && define.amd ? define(factory) :
	(global.bundle = factory());
}(this, (function () { 'use strict';

function ByteStream(data) {
  this.data = data;
  this.pos = 0;
}

// read the next byte off the stream
ByteStream.prototype.readByte = function() {
  return this.data[this.pos++];
};

// look at the next byte in the stream without updating the stream position
ByteStream.prototype.peekByte = function() {
  return this.data[this.pos];
};

// read an array of bytes
ByteStream.prototype.readBytes = function(n) {
  var bytes = new Array(n);
  for (var i = 0; i < n; i++) {
    bytes[i] = this.readByte();
  }
  return bytes;
};

// peek at an array of bytes without updating the stream position
ByteStream.prototype.peekBytes = function(n) {
  var bytes = new Array(n);
  for (var i = 0; i < n; i++) {
    bytes[i] = this.data[this.pos + i];
  }
  return bytes;
};

// read a string from a byte set
ByteStream.prototype.readString = function(len) {
  var str = '';
  for (var i = 0; i < len; i++) {
    str += String.fromCharCode(this.readByte());
  }
  return str;
};

// read a single byte and return an array of bit booleans
ByteStream.prototype.readBitArray = function() {
  var arr = [];
  var bite = this.readByte();
  for (var i = 7; i >= 0; i--) {
    arr.push(!!(bite & (1 << i)));
  }
  return arr;
};

// read an unsigned int with endian option
ByteStream.prototype.readUnsigned = function(littleEndian) {
  var a = this.readBytes(2);
  if (littleEndian) {
    return (a[1] << 8) + a[0];
  } else {
    return (a[0] << 8) + a[1];
  }
};

function DataParser(data) {
  this.stream = new ByteStream(data);
  // the final parsed object from the data
  this.output = {};
}

// combine bits to calculate value
function bitsToNum(bitArray) {
  return bitArray.reduce(function(s, n) {
    return s * 2 + n;
  }, 0);
}

DataParser.prototype.parse = function(schema) {
  // the top level schema is just the top level parts array
  this.parseParts(this.output, schema);
  return this.output;
};

// parse a set of hierarchy parts providing the parent object, and the subschema
DataParser.prototype.parseParts = function(obj, schema) {
  for (var i = 0; i < schema.length; i++) {
    var part = schema[i];
    this.parsePart(obj, part);
  }
};

DataParser.prototype.parsePart = function(obj, part) {
  var name = part.label;
  var value;

  // make sure the part meets any parse requirements
  if (part.requires && !part.requires(this.stream, this.output, obj)) {
    return;
  }

  if (part.loop) {
    // create a parse loop over the parts
    var items = [];
    while (part.loop(this.stream)) {
      var item = {};
      this.parseParts(item, part.parts);
      items.push(item);
    }
    obj[name] = items;
  } else if (part.parts) {
    // process any child parts
    value = {};
    this.parseParts(value, part.parts);
    obj[name] = value;
  } else if (part.parser) {
    // parse the value using a parser
    value = part.parser(this.stream, this.output, obj);
    if (!part.skip) {
      obj[name] = value;
    }
  } else if (part.bits) {
    // convert the next byte to a set of bit fields
    obj[name] = this.parseBits(part.bits);
  }
};

// parse a byte as a bit set (flags and values)
DataParser.prototype.parseBits = function(details) {
  var out = {};
  var bits = this.stream.readBitArray();
  for (var key in details) {
    var item = details[key];
    if (item.length) {
      // convert the bit set to value
      out[key] = bitsToNum(bits.slice(item.index, item.index + item.length));
    } else {
      out[key] = bits[item.index];
    }
  }
  return out;
};

const Parsers = {
  // read a byte
  readByte: function() {
    return function(stream) {
      return stream.readByte();
    };
  },
  // read an array of bytes
  readBytes: function(length) {
    return function(stream) {
      return stream.readBytes(length);
    };
  },
  // read a string from bytes
  readString: function(length) {
    return function(stream) {
      return stream.readString(length);
    };
  },
  // read an unsigned int (with endian)
  readUnsigned: function(littleEndian) {
    return function(stream) {
      return stream.readUnsigned(littleEndian);
    };
  },
  // read an array of byte sets
  readArray: function(size, countFunc) {
    return function(stream, obj, parent) {
      var count = countFunc(stream, obj, parent);
      var arr = new Array(count);
      for (var i = 0; i < count; i++) {
        arr[i] = stream.readBytes(size);
      }
      return arr;
    };
  }
};

/* eslint-disable camelcase */
/* eslint-disable eqeqeq */
// a set of 0x00 terminated subblocks
const subBlocks = {
  label: 'blocks',
  parser: function(stream) {
    var out = [];
    var terminator = 0x00;
    for (
      var size = stream.readByte();
      size !== terminator;
      size = stream.readByte()
    ) {
      out = out.concat(stream.readBytes(size));
    }
    return out;
  }
};

// global control extension
const gce = {
  label: 'gce',
  requires: function(stream) {
    // just peek at the top two bytes, and if true do this
    var codes = stream.peekBytes(2);
    return codes[0] === 0x21 && codes[1] === 0xf9;
  },
  parts: [
    { label: 'codes', parser: Parsers.readBytes(2), skip: true },
    { label: 'byteSize', parser: Parsers.readByte() },
    {
      label: 'extras',
      bits: {
        future: { index: 0, length: 3 },
        disposal: { index: 3, length: 3 },
        userInput: { index: 6 },
        transparentColorGiven: { index: 7 }
      }
    },
    { label: 'delay', parser: Parsers.readUnsigned(true) },
    { label: 'transparentColorIndex', parser: Parsers.readByte() },
    { label: 'terminator', parser: Parsers.readByte(), skip: true }
  ]
};

// image pipeline block
const image = {
  label: 'image',
  requires: function(stream) {
    // peek at the next byte
    var code = stream.peekByte();
    return code === 0x2c;
  },
  parts: [
    { label: 'code', parser: Parsers.readByte(), skip: true },
    {
      label: 'descriptor', // image descriptor
      parts: [
        { label: 'left', parser: Parsers.readUnsigned(true) },
        { label: 'top', parser: Parsers.readUnsigned(true) },
        { label: 'width', parser: Parsers.readUnsigned(true) },
        { label: 'height', parser: Parsers.readUnsigned(true) },
        {
          label: 'lct',
          bits: {
            exists: { index: 0 },
            interlaced: { index: 1 },
            sort: { index: 2 },
            future: { index: 3, length: 2 },
            size: { index: 5, length: 3 }
          }
        }
      ]
    },
    {
      label: 'lct', // optional local color table
      requires: function(stream, obj, parent) {
        return parent.descriptor.lct.exists;
      },
      parser: Parsers.readArray(3, function(stream, obj, parent) {
        return Math.pow(2, parent.descriptor.lct.size + 1);
      })
    },
    {
      label: 'data', // the image data blocks
      parts: [{ label: 'minCodeSize', parser: Parsers.readByte() }, subBlocks]
    }
  ]
};

// plain text block
const text = {
  label: 'text',
  requires: function(stream) {
    // just peek at the top two bytes, and if true do this
    var codes = stream.peekBytes(2);
    return codes[0] === 0x21 && codes[1] === 0x01;
  },
  parts: [
    { label: 'codes', parser: Parsers.readBytes(2), skip: true },
    { label: 'blockSize', parser: Parsers.readByte() },
    {
      label: 'preData',
      parser: function(stream, obj, parent) {
        return stream.readBytes(parent.text.blockSize);
      }
    },
    subBlocks
  ]
};

// application block
const application = {
  label: 'application',
  requires: function(stream, obj, parent) {
    // make sure this frame doesn't already have a gce, text, comment, or image
    // as that means this block should be attached to the next frame
    // if(parent.gce || parent.text || parent.image || parent.comment){ return false; }

    // peek at the top two bytes
    var codes = stream.peekBytes(2);
    return codes[0] === 0x21 && codes[1] === 0xff;
  },
  parts: [
    { label: 'codes', parser: Parsers.readBytes(2), skip: true },
    { label: 'blockSize', parser: Parsers.readByte() },
    {
      label: 'id',
      parser: function(stream, obj, parent) {
        return stream.readString(parent.blockSize);
      }
    },
    subBlocks
  ]
};

// comment block
const comment = {
  label: 'comment',
  requires: function(stream, obj, parent) {
    // make sure this frame doesn't already have a gce, text, comment, or image
    // as that means this block should be attached to the next frame
    // if(parent.gce || parent.text || parent.image || parent.comment){ return false; }

    // peek at the top two bytes
    var codes = stream.peekBytes(2);
    return codes[0] === 0x21 && codes[1] === 0xfe;
  },
  parts: [
    { label: 'codes', parser: Parsers.readBytes(2), skip: true },
    subBlocks
  ]
};

// frames of ext and image data
const frames = {
  label: 'frames',
  parts: [gce, application, comment, image, text],
  loop: function(stream) {
    var nextCode = stream.peekByte();
    // rather than check for a terminator, we should check for the existence
    // of an ext or image block to avoid infinite loops
    // var terminator = 0x3B;
    // return nextCode !== terminator;
    return nextCode === 0x21 || nextCode === 0x2c;
  }
};

const schemaGIF = [
  {
    label: 'header', // gif header
    parts: [
      { label: 'signature', parser: Parsers.readString(3) },
      { label: 'version', parser: Parsers.readString(3) }
    ]
  },
  {
    label: 'lsd', // local screen descriptor
    parts: [
      { label: 'width', parser: Parsers.readUnsigned(true) },
      { label: 'height', parser: Parsers.readUnsigned(true) },
      {
        label: 'gct',
        bits: {
          exists: { index: 0 },
          resolution: { index: 1, length: 3 },
          sort: { index: 4 },
          size: { index: 5, length: 3 }
        }
      },
      { label: 'backgroundColorIndex', parser: Parsers.readByte() },
      { label: 'pixelAspectRatio', parser: Parsers.readByte() }
    ]
  },
  {
    label: 'gct', // global color table
    requires: function(stream, obj) {
      return obj.lsd.gct.exists;
    },
    parser: Parsers.readArray(3, function(stream, obj) {
      return Math.pow(2, obj.lsd.gct.size + 1);
    })
  },
  frames // content frames
];

function GIF(arrayBuffer) {
  // convert to byte array
  var byteData = new Uint8Array(arrayBuffer);
  var parser = new DataParser(byteData);
  // parse the data
  this.raw = parser.parse(schemaGIF);

  // set a flag to make sure the gif contains at least one image
  this.raw.hasImages = false;
  for (var f = 0; f < this.raw.frames.length; f++) {
    if (this.raw.frames[f].image) {
      this.raw.hasImages = true;
      break;
    }
  }
}

// process a single gif image frames data, decompressing it using LZW
// if buildPatch is true, the returned image will be a clamped 8 bit image patch
// for use directly with a canvas.
GIF.prototype.decompressFrame = function(index, buildPatch) {
  // make sure a valid frame is requested
  if (index >= this.raw.frames.length) {
    return null;
  }

  var frame = this.raw.frames[index];
  if (frame.image) {
    // get the number of pixels
    var totalPixels =
      frame.image.descriptor.width * frame.image.descriptor.height;

    // do lzw decompression
    var pixels = lzw(
      frame.image.data.minCodeSize,
      frame.image.data.blocks,
      totalPixels
    );

    // deal with interlacing if necessary
    if (frame.image.descriptor.lct.interlaced) {
      pixels = deinterlace(pixels, frame.image.descriptor.width);
    }

    // setup usable image object
    var image = {
      pixels: pixels,
      dims: {
        top: frame.image.descriptor.top,
        left: frame.image.descriptor.left,
        width: frame.image.descriptor.width,
        height: frame.image.descriptor.height
      }
    };

    // color table
    if (frame.image.descriptor.lct && frame.image.descriptor.lct.exists) {
      image.colorTable = frame.image.lct;
    } else {
      image.colorTable = this.raw.gct;
    }

    // add per frame relevant gce information
    if (frame.gce) {
      image.delay = (frame.gce.delay || 10) * 10; // convert to ms
      image.disposalType = frame.gce.extras.disposal;
      // transparency
      if (frame.gce.extras.transparentColorGiven) {
        image.transparentIndex = frame.gce.transparentColorIndex;
      }
    }

    // create canvas usable imagedata if desired
    if (buildPatch) {
      image.patch = generatePatch(image);
    }

    return image;
  }

  // frame does not contains image
  return null;

  /**
   * javascript port of java LZW decompression
   * Original java author url: https://gist.github.com/devunwired/4479231
   */
  function lzw(minCodeSize, data, pixelCount) {
    var MAX_STACK_SIZE = 4096;
    var nullCode = -1;

    var npix = pixelCount;
    var available,
      clear,
      code_mask,
      code_size,
      end_of_information,
      in_code,
      old_code,
      bits,
      code,
      i,
      datum,
      data_size,
      first,
      top,
      bi,
      pi;

    var dstPixels = new Array(pixelCount);
    var prefix = new Array(MAX_STACK_SIZE);
    var suffix = new Array(MAX_STACK_SIZE);
    var pixelStack = new Array(MAX_STACK_SIZE + 1);

    // Initialize GIF data stream decoder.
    data_size = minCodeSize;
    clear = 1 << data_size;
    end_of_information = clear + 1;
    available = clear + 2;
    old_code = nullCode;
    code_size = data_size + 1;
    code_mask = (1 << code_size) - 1;
    for (code = 0; code < clear; code++) {
      prefix[code] = 0;
      suffix[code] = code;
    }

    // Decode GIF pixel stream.
    datum = bits = first = top = pi = bi = 0;
    for (i = 0; i < npix; ) {
      if (top === 0) {
        if (bits < code_size) {
          // get the next byte
          datum += data[bi] << bits;

          bits += 8;
          bi++;
          continue;
        }
        // Get the next code.
        code = datum & code_mask;
        datum >>= code_size;
        bits -= code_size;
        // Interpret the code
        if (code > available || code == end_of_information) {
          break;
        }
        if (code == clear) {
          // Reset decoder.
          code_size = data_size + 1;
          code_mask = (1 << code_size) - 1;
          available = clear + 2;
          old_code = nullCode;
          continue;
        }
        if (old_code == nullCode) {
          pixelStack[top++] = suffix[code];
          old_code = code;
          first = code;
          continue;
        }
        in_code = code;
        if (code == available) {
          pixelStack[top++] = first;
          code = old_code;
        }
        while (code > clear) {
          pixelStack[top++] = suffix[code];
          code = prefix[code];
        }

        first = suffix[code] & 0xff;
        pixelStack[top++] = first;

        // add a new string to the table, but only if space is available
        // if not, just continue with current table until a clear code is found
        // (deferred clear code implementation as per GIF spec)
        if (available < MAX_STACK_SIZE) {
          prefix[available] = old_code;
          suffix[available] = first;
          available++;
          if ((available & code_mask) === 0 && available < MAX_STACK_SIZE) {
            code_size++;
            code_mask += available;
          }
        }
        old_code = in_code;
      }
      // Pop a pixel off the pixel stack.
      top--;
      dstPixels[pi++] = pixelStack[top];
      i++;
    }

    for (i = pi; i < npix; i++) {
      dstPixels[i] = 0; // clear missing pixels
    }

    return dstPixels;
  }

  // deinterlace function from https://github.com/shachaf/jsgif
  function deinterlace(pixels, width) {
    var newPixels = new Array(pixels.length);
    var rows = pixels.length / width;
    var cpRow = function(toRow, fromRow) {
      var fromPixels = pixels.slice(fromRow * width, (fromRow + 1) * width);
      newPixels.splice.apply(
        newPixels,
        [toRow * width, width].concat(fromPixels)
      );
    };

    // See appendix E.
    var offsets = [0, 4, 2, 1];
    var steps = [8, 8, 4, 2];

    var fromRow = 0;
    for (var pass = 0; pass < 4; pass++) {
      for (var toRow = offsets[pass]; toRow < rows; toRow += steps[pass]) {
        cpRow(toRow, fromRow);
        fromRow++;
      }
    }

    return newPixels;
  }

  // create a clamped byte array patch for the frame image to be used directly with a canvas
  // TODO: could potentially squeeze some performance by doing a direct 32bit write per iteration
  function generatePatch(image) {
    var totalPixels = image.pixels.length;
    var patchData = new Uint8ClampedArray(totalPixels * 4);
    for (var i = 0; i < totalPixels; i++) {
      var pos = i * 4;
      var colorIndex = image.pixels[i];
      var color = image.colorTable[colorIndex];
      patchData[pos] = color[0];
      patchData[pos + 1] = color[1];
      patchData[pos + 2] = color[2];
      patchData[pos + 3] = colorIndex !== image.transparentIndex ? 255 : 0;
    }

    return patchData;
  }
};

// returns all frames decompressed
GIF.prototype.decompressFrames = function(buildPatch) {
  var frames = [];
  for (var i = 0; i < this.raw.frames.length; i++) {
    var frame = this.raw.frames[i];
    if (frame.image) {
      frames.push(this.decompressFrame(i, buildPatch));
    }
  }
  return frames;
};

/* NeuQuant Neural-Net Quantization Algorithm
 * ------------------------------------------
 *
 * Copyright (c) 1994 Anthony Dekker
 *
 * NEUQUANT Neural-Net quantization algorithm by Anthony Dekker, 1994.
 * See "Kohonen neural networks for optimal colour quantization"
 * in "Network: Computation in Neural Systems" Vol. 5 (1994) pp 351-367.
 * for a discussion of the algorithm.
 * See also  http://members.ozemail.com.au/~dekker/NEUQUANT.HTML
 *
 * Any party obtaining a copy of these files from the author, directly or
 * indirectly, is granted, free of charge, a full and unrestricted irrevocable,
 * world-wide, paid up, royalty-free, nonexclusive right and license to deal
 * in this software and documentation files (the "Software"), including without
 * limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons who receive
 * copies from any such party to do so, with the only requirement being
 * that this copyright notice remain intact.
 *
 * (JavaScript port 2012 by Johan Nordberg)
 */

function toInt(v) {
  return ~~v;
}

var ncycles = 100; // number of learning cycles
var netsize = 256; // number of colors used
var maxnetpos = netsize - 1;

// defs for freq and bias
var netbiasshift = 4; // bias for colour values
var intbiasshift = 16; // bias for fractions
var intbias = (1 << intbiasshift);
var gammashift = 10;
var betashift = 10;
var beta = (intbias >> betashift); /* beta = 1/1024 */
var betagamma = (intbias << (gammashift - betashift));

// defs for decreasing radius factor
var initrad = (netsize >> 3); // for 256 cols, radius starts
var radiusbiasshift = 6; // at 32.0 biased by 6 bits
var radiusbias = (1 << radiusbiasshift);
var initradius = (initrad * radiusbias); //and decreases by a
var radiusdec = 30; // factor of 1/30 each cycle

// defs for decreasing alpha factor
var alphabiasshift = 10; // alpha starts at 1.0
var initalpha = (1 << alphabiasshift);
/* radbias and alpharadbias used for radpower calculation */
var radbiasshift = 8;
var radbias = (1 << radbiasshift);
var alpharadbshift = (alphabiasshift + radbiasshift);
var alpharadbias = (1 << alpharadbshift);

// four primes near 500 - assume no image has a length so large that it is
// divisible by all four primes
var prime1 = 499;
var prime2 = 491;
var prime3 = 487;
var prime4 = 503;
var minpicturebytes = (3 * prime4);

/*
  Constructor: NeuQuant

  Arguments:

  pixels - array of pixels in RGB format
  samplefac - sampling factor 1 to 30 where lower is better quality

  >
  > pixels = [r, g, b, r, g, b, r, g, b, ..]
  >
*/
function NeuQuant(pixels, samplefac) {
  var network; // int[netsize][4]
  var netindex; // for network lookup - really 256

  // bias and freq arrays for learning
  var bias;
  var freq;
  var radpower;

  /*
    Private Method: init

    sets up arrays
  */
  function init() {
    network = [];
    netindex = [];
    bias = [];
    freq = [];
    radpower = [];

    var i, v;
    for (i = 0; i < netsize; i++) {
      v = (i << (netbiasshift + 8)) / netsize;
      network[i] = [v, v, v];
      freq[i] = intbias / netsize;
      bias[i] = 0;
    }
  }

  /*
    Private Method: unbiasnet

    unbiases network to give byte values 0..255 and record position i to prepare for sort
  */
  function unbiasnet() {
    for (var i = 0; i < netsize; i++) {
      network[i][0] >>= netbiasshift;
      network[i][1] >>= netbiasshift;
      network[i][2] >>= netbiasshift;
      network[i][3] = i; // record color number
    }
  }

  /*
    Private Method: altersingle

    moves neuron *i* towards biased (b,g,r) by factor *alpha*
  */
  function altersingle(alpha, i, b, g, r) {
    network[i][0] -= (alpha * (network[i][0] - b)) / initalpha;
    network[i][1] -= (alpha * (network[i][1] - g)) / initalpha;
    network[i][2] -= (alpha * (network[i][2] - r)) / initalpha;
  }

  /*
    Private Method: alterneigh

    moves neurons in *radius* around index *i* towards biased (b,g,r) by factor *alpha*
  */
  function alterneigh(radius, i, b, g, r) {
    var lo = Math.abs(i - radius);
    var hi = Math.min(i + radius, netsize);

    var j = i + 1;
    var k = i - 1;
    var m = 1;

    var p, a;
    while ((j < hi) || (k > lo)) {
      a = radpower[m++];

      if (j < hi) {
        p = network[j++];
        p[0] -= (a * (p[0] - b)) / alpharadbias;
        p[1] -= (a * (p[1] - g)) / alpharadbias;
        p[2] -= (a * (p[2] - r)) / alpharadbias;
      }

      if (k > lo) {
        p = network[k--];
        p[0] -= (a * (p[0] - b)) / alpharadbias;
        p[1] -= (a * (p[1] - g)) / alpharadbias;
        p[2] -= (a * (p[2] - r)) / alpharadbias;
      }
    }
  }

  /*
    Private Method: contest

    searches for biased BGR values
  */
  function contest(b, g, r) {
    /*
      finds closest neuron (min dist) and updates freq
      finds best neuron (min dist-bias) and returns position
      for frequently chosen neurons, freq[i] is high and bias[i] is negative
      bias[i] = gamma * ((1 / netsize) - freq[i])
    */

    var bestd = ~(1 << 31);
    var bestbiasd = bestd;
    var bestpos = -1;
    var bestbiaspos = bestpos;

    var i, n, dist, biasdist, betafreq;
    for (i = 0; i < netsize; i++) {
      n = network[i];

      dist = Math.abs(n[0] - b) + Math.abs(n[1] - g) + Math.abs(n[2] - r);
      if (dist < bestd) {
        bestd = dist;
        bestpos = i;
      }

      biasdist = dist - ((bias[i]) >> (intbiasshift - netbiasshift));
      if (biasdist < bestbiasd) {
        bestbiasd = biasdist;
        bestbiaspos = i;
      }

      betafreq = (freq[i] >> betashift);
      freq[i] -= betafreq;
      bias[i] += (betafreq << gammashift);
    }

    freq[bestpos] += beta;
    bias[bestpos] -= betagamma;

    return bestbiaspos;
  }

  /*
    Private Method: inxbuild

    sorts network and builds netindex[0..255]
  */
  function inxbuild() {
    var i, j, p, q, smallpos, smallval, previouscol = 0, startpos = 0;
    for (i = 0; i < netsize; i++) {
      p = network[i];
      smallpos = i;
      smallval = p[1]; // index on g
      // find smallest in i..netsize-1
      for (j = i + 1; j < netsize; j++) {
        q = network[j];
        if (q[1] < smallval) { // index on g
          smallpos = j;
          smallval = q[1]; // index on g
        }
      }
      q = network[smallpos];
      // swap p (i) and q (smallpos) entries
      if (i != smallpos) {
        j = q[0];   q[0] = p[0];   p[0] = j;
        j = q[1];   q[1] = p[1];   p[1] = j;
        j = q[2];   q[2] = p[2];   p[2] = j;
        j = q[3];   q[3] = p[3];   p[3] = j;
      }
      // smallval entry is now in position i

      if (smallval != previouscol) {
        netindex[previouscol] = (startpos + i) >> 1;
        for (j = previouscol + 1; j < smallval; j++)
          netindex[j] = i;
        previouscol = smallval;
        startpos = i;
      }
    }
    netindex[previouscol] = (startpos + maxnetpos) >> 1;
    for (j = previouscol + 1; j < 256; j++)
      netindex[j] = maxnetpos; // really 256
  }

  /*
    Private Method: inxsearch

    searches for BGR values 0..255 and returns a color index
  */
  function inxsearch(b, g, r) {
    var a, p, dist;

    var bestd = 1000; // biggest possible dist is 256*3
    var best = -1;

    var i = netindex[g]; // index on g
    var j = i - 1; // start at netindex[g] and work outwards

    while ((i < netsize) || (j >= 0)) {
      if (i < netsize) {
        p = network[i];
        dist = p[1] - g; // inx key
        if (dist >= bestd) i = netsize; // stop iter
        else {
          i++;
          if (dist < 0) dist = -dist;
          a = p[0] - b; if (a < 0) a = -a;
          dist += a;
          if (dist < bestd) {
            a = p[2] - r; if (a < 0) a = -a;
            dist += a;
            if (dist < bestd) {
              bestd = dist;
              best = p[3];
            }
          }
        }
      }
      if (j >= 0) {
        p = network[j];
        dist = g - p[1]; // inx key - reverse dif
        if (dist >= bestd) j = -1; // stop iter
        else {
          j--;
          if (dist < 0) dist = -dist;
          a = p[0] - b; if (a < 0) a = -a;
          dist += a;
          if (dist < bestd) {
            a = p[2] - r; if (a < 0) a = -a;
            dist += a;
            if (dist < bestd) {
              bestd = dist;
              best = p[3];
            }
          }
        }
      }
    }

    return best;
  }

  /*
    Private Method: learn

    "Main Learning Loop"
  */
  function learn() {
    var i;

    var lengthcount = pixels.length;
    var alphadec = toInt(30 + ((samplefac - 1) / 3));
    var samplepixels = toInt(lengthcount / (3 * samplefac));
    var delta = toInt(samplepixels / ncycles);
    var alpha = initalpha;
    var radius = initradius;

    var rad = radius >> radiusbiasshift;

    if (rad <= 1) rad = 0;
    for (i = 0; i < rad; i++)
      radpower[i] = toInt(alpha * (((rad * rad - i * i) * radbias) / (rad * rad)));

    var step;
    if (lengthcount < minpicturebytes) {
      samplefac = 1;
      step = 3;
    } else if ((lengthcount % prime1) !== 0) {
      step = 3 * prime1;
    } else if ((lengthcount % prime2) !== 0) {
      step = 3 * prime2;
    } else if ((lengthcount % prime3) !== 0)  {
      step = 3 * prime3;
    } else {
      step = 3 * prime4;
    }

    var b, g, r, j;
    var pix = 0; // current pixel

    i = 0;
    while (i < samplepixels) {
      b = (pixels[pix] & 0xff) << netbiasshift;
      g = (pixels[pix + 1] & 0xff) << netbiasshift;
      r = (pixels[pix + 2] & 0xff) << netbiasshift;

      j = contest(b, g, r);

      altersingle(alpha, j, b, g, r);
      if (rad !== 0) alterneigh(rad, j, b, g, r); // alter neighbours

      pix += step;
      if (pix >= lengthcount) pix -= lengthcount;

      i++;

      if (delta === 0) delta = 1;
      if (i % delta === 0) {
        alpha -= alpha / alphadec;
        radius -= radius / radiusdec;
        rad = radius >> radiusbiasshift;

        if (rad <= 1) rad = 0;
        for (j = 0; j < rad; j++)
          radpower[j] = toInt(alpha * (((rad * rad - j * j) * radbias) / (rad * rad)));
      }
    }
  }

  /*
    Method: buildColormap

    1. initializes network
    2. trains it
    3. removes misconceptions
    4. builds colorindex
  */
  function buildColormap() {
    init();
    learn();
    unbiasnet();
    inxbuild();
  }
  this.buildColormap = buildColormap;

  /*
    Method: getColormap

    builds colormap from the index

    returns array in the format:

    >
    > [r, g, b, r, g, b, r, g, b, ..]
    >
  */
  function getColormap() {
    var map = [];
    var index = [];

    for (var i = 0; i < netsize; i++)
      index[network[i][3]] = i;

    var k = 0;
    for (var l = 0; l < netsize; l++) {
      var j = index[l];
      map[k++] = (network[j][0]);
      map[k++] = (network[j][1]);
      map[k++] = (network[j][2]);
    }
    return map;
  }
  this.getColormap = getColormap;

  /*
    Method: lookupRGB

    looks for the closest *r*, *g*, *b* color in the map and
    returns its index
  */
  this.lookupRGB = inxsearch;
}

var NeuQuant_1 = NeuQuant;

/* NeuQuant Neural-Net Quantization Algorithm
 * ------------------------------------------
 *
 * Copyright (c) 1994 Anthony Dekker
 *
 * NEUQUANT Neural-Net quantization algorithm by Anthony Dekker, 1994.
 * See "Kohonen neural networks for optimal colour quantization"
 * in "Network: Computation in Neural Systems" Vol. 5 (1994) pp 351-367.
 * for a discussion of the algorithm.
 * See also  http://members.ozemail.com.au/~dekker/NEUQUANT.HTML
 *
 * Any party obtaining a copy of these files from the author, directly or
 * indirectly, is granted, free of charge, a full and unrestricted irrevocable,
 * world-wide, paid up, royalty-free, nonexclusive right and license to deal
 * in this software and documentation files (the "Software"), including without
 * limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons who receive
 * copies from any such party to do so, with the only requirement being
 * that this copyright notice remain intact.
 *
 * (JavaScript port 2012 by Johan Nordberg)
 */

var ncycles$1 = 100; // number of learning cycles
var netsize$1 = 256; // number of colors used
var maxnetpos$1 = netsize$1 - 1;

// defs for freq and bias
var netbiasshift$1 = 4; // bias for colour values
var intbiasshift$1 = 16; // bias for fractions
var intbias$1 = (1 << intbiasshift$1);
var gammashift$1 = 10;
var betashift$1 = 10;
var beta$1 = (intbias$1 >> betashift$1); /* beta = 1/1024 */
var betagamma$1 = (intbias$1 << (gammashift$1 - betashift$1));

// defs for decreasing radius factor
var initrad$1 = (netsize$1 >> 3); // for 256 cols, radius starts
var radiusbiasshift$1 = 6; // at 32.0 biased by 6 bits
var radiusbias$1 = (1 << radiusbiasshift$1);
var initradius$1 = (initrad$1 * radiusbias$1); //and decreases by a
var radiusdec$1 = 30; // factor of 1/30 each cycle

// defs for decreasing alpha factor
var alphabiasshift$1 = 10; // alpha starts at 1.0
var initalpha$1 = (1 << alphabiasshift$1);
/* radbias and alpharadbias used for radpower calculation */
var radbiasshift$1 = 8;
var radbias$1 = (1 << radbiasshift$1);
var alpharadbshift$1 = (alphabiasshift$1 + radbiasshift$1);
var alpharadbias$1 = (1 << alpharadbshift$1);

// four primes near 500 - assume no image has a length so large that it is
// divisible by all four primes
var prime1$1 = 499;
var prime2$1 = 491;
var prime3$1 = 487;
var prime4$1 = 503;
var minpicturebytes$1 = (3 * prime4$1);

/*
  Constructor: NeuQuant

  Arguments:

  pixels - array of pixels in RGB format
  samplefac - sampling factor 1 to 30 where lower is better quality

  >
  > pixels = [r, g, b, r, g, b, r, g, b, ..]
  >
*/
function NeuQuant$1(pixels, samplefac) {
  var network; // int[netsize][4]
  var netindex; // for network lookup - really 256

  // bias and freq arrays for learning
  var bias;
  var freq;
  var radpower;

  /*
    Private Method: init

    sets up arrays
  */
  function init() {
    network = [];
    netindex = new Int32Array(256);
    bias = new Int32Array(netsize$1);
    freq = new Int32Array(netsize$1);
    radpower = new Int32Array(netsize$1 >> 3);

    var i, v;
    for (i = 0; i < netsize$1; i++) {
      v = (i << (netbiasshift$1 + 8)) / netsize$1;
      network[i] = new Float64Array([v, v, v, 0]);
      //network[i] = [v, v, v, 0]
      freq[i] = intbias$1 / netsize$1;
      bias[i] = 0;
    }
  }

  /*
    Private Method: unbiasnet

    unbiases network to give byte values 0..255 and record position i to prepare for sort
  */
  function unbiasnet() {
    for (var i = 0; i < netsize$1; i++) {
      network[i][0] >>= netbiasshift$1;
      network[i][1] >>= netbiasshift$1;
      network[i][2] >>= netbiasshift$1;
      network[i][3] = i; // record color number
    }
  }

  /*
    Private Method: altersingle

    moves neuron *i* towards biased (b,g,r) by factor *alpha*
  */
  function altersingle(alpha, i, b, g, r) {
    network[i][0] -= (alpha * (network[i][0] - b)) / initalpha$1;
    network[i][1] -= (alpha * (network[i][1] - g)) / initalpha$1;
    network[i][2] -= (alpha * (network[i][2] - r)) / initalpha$1;
  }

  /*
    Private Method: alterneigh

    moves neurons in *radius* around index *i* towards biased (b,g,r) by factor *alpha*
  */
  function alterneigh(radius, i, b, g, r) {
    var lo = Math.abs(i - radius);
    var hi = Math.min(i + radius, netsize$1);

    var j = i + 1;
    var k = i - 1;
    var m = 1;

    var p, a;
    while ((j < hi) || (k > lo)) {
      a = radpower[m++];

      if (j < hi) {
        p = network[j++];
        p[0] -= (a * (p[0] - b)) / alpharadbias$1;
        p[1] -= (a * (p[1] - g)) / alpharadbias$1;
        p[2] -= (a * (p[2] - r)) / alpharadbias$1;
      }

      if (k > lo) {
        p = network[k--];
        p[0] -= (a * (p[0] - b)) / alpharadbias$1;
        p[1] -= (a * (p[1] - g)) / alpharadbias$1;
        p[2] -= (a * (p[2] - r)) / alpharadbias$1;
      }
    }
  }

  /*
    Private Method: contest

    searches for biased BGR values
  */
  function contest(b, g, r) {
    /*
      finds closest neuron (min dist) and updates freq
      finds best neuron (min dist-bias) and returns position
      for frequently chosen neurons, freq[i] is high and bias[i] is negative
      bias[i] = gamma * ((1 / netsize) - freq[i])
    */

    var bestd = ~(1 << 31);
    var bestbiasd = bestd;
    var bestpos = -1;
    var bestbiaspos = bestpos;

    var i, n, dist, biasdist, betafreq;
    for (i = 0; i < netsize$1; i++) {
      n = network[i];

      dist = Math.abs(n[0] - b) + Math.abs(n[1] - g) + Math.abs(n[2] - r);
      if (dist < bestd) {
        bestd = dist;
        bestpos = i;
      }

      biasdist = dist - ((bias[i]) >> (intbiasshift$1 - netbiasshift$1));
      if (biasdist < bestbiasd) {
        bestbiasd = biasdist;
        bestbiaspos = i;
      }

      betafreq = (freq[i] >> betashift$1);
      freq[i] -= betafreq;
      bias[i] += (betafreq << gammashift$1);
    }

    freq[bestpos] += beta$1;
    bias[bestpos] -= betagamma$1;

    return bestbiaspos;
  }

  /*
    Private Method: inxbuild

    sorts network and builds netindex[0..255]
  */
  function inxbuild() {
    var i, j, p, q, smallpos, smallval, previouscol = 0, startpos = 0;
    for (i = 0; i < netsize$1; i++) {
      p = network[i];
      smallpos = i;
      smallval = p[1]; // index on g
      // find smallest in i..netsize-1
      for (j = i + 1; j < netsize$1; j++) {
        q = network[j];
        if (q[1] < smallval) { // index on g
          smallpos = j;
          smallval = q[1]; // index on g
        }
      }
      q = network[smallpos];
      // swap p (i) and q (smallpos) entries
      if (i != smallpos) {
        j = q[0];   q[0] = p[0];   p[0] = j;
        j = q[1];   q[1] = p[1];   p[1] = j;
        j = q[2];   q[2] = p[2];   p[2] = j;
        j = q[3];   q[3] = p[3];   p[3] = j;
      }
      // smallval entry is now in position i

      if (smallval != previouscol) {
        netindex[previouscol] = (startpos + i) >> 1;
        for (j = previouscol + 1; j < smallval; j++)
          netindex[j] = i;
        previouscol = smallval;
        startpos = i;
      }
    }
    netindex[previouscol] = (startpos + maxnetpos$1) >> 1;
    for (j = previouscol + 1; j < 256; j++)
      netindex[j] = maxnetpos$1; // really 256
  }

  /*
    Private Method: inxsearch

    searches for BGR values 0..255 and returns a color index
  */
  function inxsearch(b, g, r) {
    var a, p, dist;

    var bestd = 1000; // biggest possible dist is 256*3
    var best = -1;

    var i = netindex[g]; // index on g
    var j = i - 1; // start at netindex[g] and work outwards

    while ((i < netsize$1) || (j >= 0)) {
      if (i < netsize$1) {
        p = network[i];
        dist = p[1] - g; // inx key
        if (dist >= bestd) i = netsize$1; // stop iter
        else {
          i++;
          if (dist < 0) dist = -dist;
          a = p[0] - b; if (a < 0) a = -a;
          dist += a;
          if (dist < bestd) {
            a = p[2] - r; if (a < 0) a = -a;
            dist += a;
            if (dist < bestd) {
              bestd = dist;
              best = p[3];
            }
          }
        }
      }
      if (j >= 0) {
        p = network[j];
        dist = g - p[1]; // inx key - reverse dif
        if (dist >= bestd) j = -1; // stop iter
        else {
          j--;
          if (dist < 0) dist = -dist;
          a = p[0] - b; if (a < 0) a = -a;
          dist += a;
          if (dist < bestd) {
            a = p[2] - r; if (a < 0) a = -a;
            dist += a;
            if (dist < bestd) {
              bestd = dist;
              best = p[3];
            }
          }
        }
      }
    }

    return best;
  }

  /*
    Private Method: learn

    "Main Learning Loop"
  */
  function learn() {
    var i;

    var lengthcount = pixels.length;
    var alphadec = 30 + ((samplefac - 1) / 3);
    var samplepixels = lengthcount / (3 * samplefac);
    var delta = ~~(samplepixels / ncycles$1);
    var alpha = initalpha$1;
    var radius = initradius$1;

    var rad = radius >> radiusbiasshift$1;

    if (rad <= 1) rad = 0;
    for (i = 0; i < rad; i++)
      radpower[i] = alpha * (((rad * rad - i * i) * radbias$1) / (rad * rad));

    var step;
    if (lengthcount < minpicturebytes$1) {
      samplefac = 1;
      step = 3;
    } else if ((lengthcount % prime1$1) !== 0) {
      step = 3 * prime1$1;
    } else if ((lengthcount % prime2$1) !== 0) {
      step = 3 * prime2$1;
    } else if ((lengthcount % prime3$1) !== 0)  {
      step = 3 * prime3$1;
    } else {
      step = 3 * prime4$1;
    }

    var b, g, r, j;
    var pix = 0; // current pixel

    i = 0;
    while (i < samplepixels) {
      b = (pixels[pix] & 0xff) << netbiasshift$1;
      g = (pixels[pix + 1] & 0xff) << netbiasshift$1;
      r = (pixels[pix + 2] & 0xff) << netbiasshift$1;

      j = contest(b, g, r);

      altersingle(alpha, j, b, g, r);
      if (rad !== 0) alterneigh(rad, j, b, g, r); // alter neighbours

      pix += step;
      if (pix >= lengthcount) pix -= lengthcount;

      i++;

      if (delta === 0) delta = 1;
      if (i % delta === 0) {
        alpha -= alpha / alphadec;
        radius -= radius / radiusdec$1;
        rad = radius >> radiusbiasshift$1;

        if (rad <= 1) rad = 0;
        for (j = 0; j < rad; j++)
          radpower[j] = alpha * (((rad * rad - j * j) * radbias$1) / (rad * rad));
      }
    }
  }

  /*
    Method: buildColormap

    1. initializes network
    2. trains it
    3. removes misconceptions
    4. builds colorindex
  */
  function buildColormap() {
    init();
    learn();
    unbiasnet();
    inxbuild();
  }
  this.buildColormap = buildColormap;

  /*
    Method: getColormap

    builds colormap from the index

    returns array in the format:

    >
    > [r, g, b, r, g, b, r, g, b, ..]
    >
  */
  function getColormap() {
    var map = [];
    var index = [];

    for (var i = 0; i < netsize$1; i++)
      index[network[i][3]] = i;

    var k = 0;
    for (var l = 0; l < netsize$1; l++) {
      var j = index[l];
      map[k++] = (network[j][0]);
      map[k++] = (network[j][1]);
      map[k++] = (network[j][2]);
    }
    return map;
  }
  this.getColormap = getColormap;

  /*
    Method: lookupRGB

    looks for the closest *r*, *g*, *b* color in the map and
    returns its index
  */
  this.lookupRGB = inxsearch;
}

var TypedNeuQuant = NeuQuant$1;

/*
  LZWEncoder.js

  Authors
  Kevin Weiner (original Java version - kweiner@fmsware.com)
  Thibault Imbert (AS3 version - bytearray.org)
  Johan Nordberg (JS version - code@johan-nordberg.com)

  Acknowledgements
  GIFCOMPR.C - GIF Image compression routines
  Lempel-Ziv compression based on 'compress'. GIF modifications by
  David Rowley (mgardi@watdcsu.waterloo.edu)
  GIF Image compression - modified 'compress'
  Based on: compress.c - File compression ala IEEE Computer, June 1984.
  By Authors: Spencer W. Thomas (decvax!harpo!utah-cs!utah-gr!thomas)
  Jim McKie (decvax!mcvax!jim)
  Steve Davies (decvax!vax135!petsd!peora!srd)
  Ken Turkowski (decvax!decwrl!turtlevax!ken)
  James A. Woods (decvax!ihnp4!ames!jaw)
  Joe Orost (decvax!vax135!petsd!joe)
*/

var EOF = -1;
var BITS = 12;
var HSIZE = 5003; // 80% occupancy
var masks = [0x0000, 0x0001, 0x0003, 0x0007, 0x000F, 0x001F,
             0x003F, 0x007F, 0x00FF, 0x01FF, 0x03FF, 0x07FF,
             0x0FFF, 0x1FFF, 0x3FFF, 0x7FFF, 0xFFFF];

function LZWEncoder(width, height, pixels, colorDepth) {
  var initCodeSize = Math.max(2, colorDepth);

  var accum = new Uint8Array(256);
  var htab = new Int32Array(HSIZE);
  var codetab = new Int32Array(HSIZE);

  var cur_accum, cur_bits = 0;
  var a_count;
  var free_ent = 0; // first unused entry
  var maxcode;

  // block compression parameters -- after all codes are used up,
  // and compression rate changes, start over.
  var clear_flg = false;

  // Algorithm: use open addressing double hashing (no chaining) on the
  // prefix code / next character combination. We do a variant of Knuth's
  // algorithm D (vol. 3, sec. 6.4) along with G. Knott's relatively-prime
  // secondary probe. Here, the modular division first probe is gives way
  // to a faster exclusive-or manipulation. Also do block compression with
  // an adaptive reset, whereby the code table is cleared when the compression
  // ratio decreases, but after the table fills. The variable-length output
  // codes are re-sized at this point, and a special CLEAR code is generated
  // for the decompressor. Late addition: construct the table according to
  // file size for noticeable speed improvement on small files. Please direct
  // questions about this implementation to ames!jaw.
  var g_init_bits, ClearCode, EOFCode;

  // Add a character to the end of the current packet, and if it is 254
  // characters, flush the packet to disk.
  function char_out(c, outs) {
    accum[a_count++] = c;
    if (a_count >= 254) flush_char(outs);
  }

  // Clear out the hash table
  // table clear for block compress
  function cl_block(outs) {
    cl_hash(HSIZE);
    free_ent = ClearCode + 2;
    clear_flg = true;
    output(ClearCode, outs);
  }

  // Reset code table
  function cl_hash(hsize) {
    for (var i = 0; i < hsize; ++i) htab[i] = -1;
  }

  function compress(init_bits, outs) {
    var fcode, c, i, ent, disp, hsize_reg, hshift;

    // Set up the globals: g_init_bits - initial number of bits
    g_init_bits = init_bits;

    // Set up the necessary values
    clear_flg = false;
    n_bits = g_init_bits;
    maxcode = MAXCODE(n_bits);

    ClearCode = 1 << (init_bits - 1);
    EOFCode = ClearCode + 1;
    free_ent = ClearCode + 2;

    a_count = 0; // clear packet

    ent = nextPixel();

    hshift = 0;
    for (fcode = HSIZE; fcode < 65536; fcode *= 2) ++hshift;
    hshift = 8 - hshift; // set hash code range bound
    hsize_reg = HSIZE;
    cl_hash(hsize_reg); // clear hash table

    output(ClearCode, outs);

    outer_loop: while ((c = nextPixel()) != EOF) {
      fcode = (c << BITS) + ent;
      i = (c << hshift) ^ ent; // xor hashing
      if (htab[i] === fcode) {
        ent = codetab[i];
        continue;
      } else if (htab[i] >= 0) { // non-empty slot
        disp = hsize_reg - i; // secondary hash (after G. Knott)
        if (i === 0) disp = 1;
        do {
          if ((i -= disp) < 0) i += hsize_reg;
          if (htab[i] === fcode) {
            ent = codetab[i];
            continue outer_loop;
          }
        } while (htab[i] >= 0);
      }
      output(ent, outs);
      ent = c;
      if (free_ent < 1 << BITS) {
        codetab[i] = free_ent++; // code -> hashtable
        htab[i] = fcode;
      } else {
        cl_block(outs);
      }
    }

    // Put out the final code.
    output(ent, outs);
    output(EOFCode, outs);
  }

  function encode(outs) {
    outs.writeByte(initCodeSize); // write "initial code size" byte
    remaining = width * height; // reset navigation variables
    curPixel = 0;
    compress(initCodeSize + 1, outs); // compress and write the pixel data
    outs.writeByte(0); // write block terminator
  }

  // Flush the packet to disk, and reset the accumulator
  function flush_char(outs) {
    if (a_count > 0) {
      outs.writeByte(a_count);
      outs.writeBytes(accum, 0, a_count);
      a_count = 0;
    }
  }

  function MAXCODE(n_bits) {
    return (1 << n_bits) - 1;
  }

  // Return the next pixel from the image
  function nextPixel() {
    if (remaining === 0) return EOF;
    --remaining;
    var pix = pixels[curPixel++];
    return pix & 0xff;
  }

  function output(code, outs) {
    cur_accum &= masks[cur_bits];

    if (cur_bits > 0) cur_accum |= (code << cur_bits);
    else cur_accum = code;

    cur_bits += n_bits;

    while (cur_bits >= 8) {
      char_out((cur_accum & 0xff), outs);
      cur_accum >>= 8;
      cur_bits -= 8;
    }

    // If the next entry is going to be too big for the code size,
    // then increase it, if possible.
    if (free_ent > maxcode || clear_flg) {
      if (clear_flg) {
        maxcode = MAXCODE(n_bits = g_init_bits);
        clear_flg = false;
      } else {
        ++n_bits;
        if (n_bits == BITS) maxcode = 1 << BITS;
        else maxcode = MAXCODE(n_bits);
      }
    }

    if (code == EOFCode) {
      // At EOF, write the rest of the buffer.
      while (cur_bits > 0) {
        char_out((cur_accum & 0xff), outs);
        cur_accum >>= 8;
        cur_bits -= 8;
      }
      flush_char(outs);
    }
  }

  this.encode = encode;
}

var LZWEncoder_1 = LZWEncoder;

/*
  GIFEncoder.js

  Authors
  Kevin Weiner (original Java version - kweiner@fmsware.com)
  Thibault Imbert (AS3 version - bytearray.org)
  Johan Nordberg (JS version - code@johan-nordberg.com)
*/




function ByteArray() {
  this.page = -1;
  this.pages = [];
  this.newPage();
}

ByteArray.pageSize = 4096;
ByteArray.charMap = {};

for (var i = 0; i < 256; i++)
  ByteArray.charMap[i] = String.fromCharCode(i);

ByteArray.prototype.newPage = function() {
  this.pages[++this.page] = new Uint8Array(ByteArray.pageSize);
  this.cursor = 0;
};

ByteArray.prototype.getData = function() {
  var rv = '';
  for (var p = 0; p < this.pages.length; p++) {
    for (var i = 0; i < ByteArray.pageSize; i++) {
      rv += ByteArray.charMap[this.pages[p][i]];
    }
  }
  return rv;
};

ByteArray.prototype.writeByte = function(val) {
  if (this.cursor >= ByteArray.pageSize) this.newPage();
  this.pages[this.page][this.cursor++] = val;
};

ByteArray.prototype.writeUTFBytes = function(string) {
  for (var l = string.length, i = 0; i < l; i++)
    this.writeByte(string.charCodeAt(i));
};

ByteArray.prototype.writeBytes = function(array, offset, length) {
  for (var l = length || array.length, i = offset || 0; i < l; i++)
    this.writeByte(array[i]);
};

function GIFEncoder(width, height) {
  // image size
  this.width = ~~width;
  this.height = ~~height;

  // transparent color if given
  this.transparent = null;

  // transparent index in color table
  this.transIndex = 0;

  // -1 = no repeat, 0 = forever. anything else is repeat count
  this.repeat = -1;

  // frame delay (hundredths)
  this.delay = 0;

  this.image = null; // current frame
  this.pixels = null; // BGR byte array from frame
  this.indexedPixels = null; // converted frame indexed to palette
  this.colorDepth = null; // number of bit planes
  this.colorTab = null; // RGB palette
  this.neuQuant = null; // NeuQuant instance that was used to generate this.colorTab.
  this.usedEntry = new Array(); // active palette entries
  this.palSize = 7; // color table size (bits-1)
  this.dispose = -1; // disposal code (-1 = use default)
  this.firstFrame = true;
  this.sample = 10; // default sample interval for quantizer
  this.dither = false; // default dithering
  this.globalPalette = false;

  this.out = new ByteArray();
}

/*
  Sets the delay time between each frame, or changes it for subsequent frames
  (applies to last frame added)
*/
GIFEncoder.prototype.setDelay = function(milliseconds) {
  this.delay = Math.round(milliseconds / 10);
};

/*
  Sets frame rate in frames per second.
*/
GIFEncoder.prototype.setFrameRate = function(fps) {
  this.delay = Math.round(100 / fps);
};

/*
  Sets the GIF frame disposal code for the last added frame and any
  subsequent frames.

  Default is 0 if no transparent color has been set, otherwise 2.
*/
GIFEncoder.prototype.setDispose = function(disposalCode) {
  if (disposalCode >= 0) this.dispose = disposalCode;
};

/*
  Sets the number of times the set of GIF frames should be played.

  -1 = play once
  0 = repeat indefinitely

  Default is -1

  Must be invoked before the first image is added
*/

GIFEncoder.prototype.setRepeat = function(repeat) {
  this.repeat = repeat;
};

/*
  Sets the transparent color for the last added frame and any subsequent
  frames. Since all colors are subject to modification in the quantization
  process, the color in the final palette for each frame closest to the given
  color becomes the transparent color for that frame. May be set to null to
  indicate no transparent color.
*/
GIFEncoder.prototype.setTransparent = function(color) {
  this.transparent = color;
};

/*
  Adds next GIF frame. The frame is not written immediately, but is
  actually deferred until the next frame is received so that timing
  data can be inserted.  Invoking finish() flushes all frames.
*/
GIFEncoder.prototype.addFrame = function(imageData) {
  this.image = imageData;

  this.colorTab = this.globalPalette && this.globalPalette.slice ? this.globalPalette : null;

  this.getImagePixels(); // convert to correct format if necessary
  this.analyzePixels(); // build color table & map pixels

  if (this.globalPalette === true) this.globalPalette = this.colorTab;

  if (this.firstFrame) {
    this.writeLSD(); // logical screen descriptior
    this.writePalette(); // global color table
    if (this.repeat >= 0) {
      // use NS app extension to indicate reps
      this.writeNetscapeExt();
    }
  }

  this.writeGraphicCtrlExt(); // write graphic control extension
  this.writeImageDesc(); // image descriptor
  if (!this.firstFrame && !this.globalPalette) this.writePalette(); // local color table
  this.writePixels(); // encode and write pixel data

  this.firstFrame = false;
};

/*
  Adds final trailer to the GIF stream, if you don't call the finish method
  the GIF stream will not be valid.
*/
GIFEncoder.prototype.finish = function() {
  this.out.writeByte(0x3b); // gif trailer
};

/*
  Sets quality of color quantization (conversion of images to the maximum 256
  colors allowed by the GIF specification). Lower values (minimum = 1)
  produce better colors, but slow processing significantly. 10 is the
  default, and produces good color mapping at reasonable speeds. Values
  greater than 20 do not yield significant improvements in speed.
*/
GIFEncoder.prototype.setQuality = function(quality) {
  if (quality < 1) quality = 1;
  this.sample = quality;
};

/*
  Sets dithering method. Available are:
  - FALSE no dithering
  - TRUE or FloydSteinberg
  - FalseFloydSteinberg
  - Stucki
  - Atkinson
  You can add '-serpentine' to use serpentine scanning
*/
GIFEncoder.prototype.setDither = function(dither) {
  if (dither === true) dither = 'FloydSteinberg';
  this.dither = dither;
};

/*
  Sets global palette for all frames.
  You can provide TRUE to create global palette from first picture.
  Or an array of r,g,b,r,g,b,...
*/
GIFEncoder.prototype.setGlobalPalette = function(palette) {
  this.globalPalette = palette;
};

/*
  Returns global palette used for all frames.
  If setGlobalPalette(true) was used, then this function will return
  calculated palette after the first frame is added.
*/
GIFEncoder.prototype.getGlobalPalette = function() {
  return (this.globalPalette && this.globalPalette.slice && this.globalPalette.slice(0)) || this.globalPalette;
};

/*
  Writes GIF file header
*/
GIFEncoder.prototype.writeHeader = function() {
  this.out.writeUTFBytes("GIF89a");
};

/*
  Analyzes current frame colors and creates color map.
*/
GIFEncoder.prototype.analyzePixels = function() {
  if (!this.colorTab) {
    this.neuQuant = new TypedNeuQuant(this.pixels, this.sample);
    this.neuQuant.buildColormap(); // create reduced palette
    this.colorTab = this.neuQuant.getColormap();
  }

  // map image pixels to new palette
  if (this.dither) {
    this.ditherPixels(this.dither.replace('-serpentine', ''), this.dither.match(/-serpentine/) !== null);
  } else {
    this.indexPixels();
  }

  this.pixels = null;
  this.colorDepth = 8;
  this.palSize = 7;

  // get closest match to transparent color if specified
  if (this.transparent !== null) {
    this.transIndex = this.findClosest(this.transparent, true);
  }
};

/*
  Index pixels, without dithering
*/
GIFEncoder.prototype.indexPixels = function(imgq) {
  var nPix = this.pixels.length / 3;
  this.indexedPixels = new Uint8Array(nPix);
  var k = 0;
  for (var j = 0; j < nPix; j++) {
    var index = this.findClosestRGB(
      this.pixels[k++] & 0xff,
      this.pixels[k++] & 0xff,
      this.pixels[k++] & 0xff
    );
    this.usedEntry[index] = true;
    this.indexedPixels[j] = index;
  }
};

/*
  Taken from http://jsbin.com/iXofIji/2/edit by PAEz
*/
GIFEncoder.prototype.ditherPixels = function(kernel, serpentine) {
  var kernels = {
    FalseFloydSteinberg: [
      [3 / 8, 1, 0],
      [3 / 8, 0, 1],
      [2 / 8, 1, 1]
    ],
    FloydSteinberg: [
      [7 / 16, 1, 0],
      [3 / 16, -1, 1],
      [5 / 16, 0, 1],
      [1 / 16, 1, 1]
    ],
    Stucki: [
      [8 / 42, 1, 0],
      [4 / 42, 2, 0],
      [2 / 42, -2, 1],
      [4 / 42, -1, 1],
      [8 / 42, 0, 1],
      [4 / 42, 1, 1],
      [2 / 42, 2, 1],
      [1 / 42, -2, 2],
      [2 / 42, -1, 2],
      [4 / 42, 0, 2],
      [2 / 42, 1, 2],
      [1 / 42, 2, 2]
    ],
    Atkinson: [
      [1 / 8, 1, 0],
      [1 / 8, 2, 0],
      [1 / 8, -1, 1],
      [1 / 8, 0, 1],
      [1 / 8, 1, 1],
      [1 / 8, 0, 2]
    ]
  };

  if (!kernel || !kernels[kernel]) {
    throw 'Unknown dithering kernel: ' + kernel;
  }

  var ds = kernels[kernel];
  var index = 0,
    height = this.height,
    width = this.width,
    data = this.pixels;
  var direction = serpentine ? -1 : 1;

  this.indexedPixels = new Uint8Array(this.pixels.length / 3);

  for (var y = 0; y < height; y++) {

    if (serpentine) direction = direction * -1;

    for (var x = (direction == 1 ? 0 : width - 1), xend = (direction == 1 ? width : 0); x !== xend; x += direction) {

      index = (y * width) + x;
      // Get original colour
      var idx = index * 3;
      var r1 = data[idx];
      var g1 = data[idx + 1];
      var b1 = data[idx + 2];

      // Get converted colour
      idx = this.findClosestRGB(r1, g1, b1);
      this.usedEntry[idx] = true;
      this.indexedPixels[index] = idx;
      idx *= 3;
      var r2 = this.colorTab[idx];
      var g2 = this.colorTab[idx + 1];
      var b2 = this.colorTab[idx + 2];

      var er = r1 - r2;
      var eg = g1 - g2;
      var eb = b1 - b2;

      for (var i = (direction == 1 ? 0: ds.length - 1), end = (direction == 1 ? ds.length : 0); i !== end; i += direction) {
        var x1 = ds[i][1]; // *direction;  //  Should this by timesd by direction?..to make the kernel go in the opposite direction....got no idea....
        var y1 = ds[i][2];
        if (x1 + x >= 0 && x1 + x < width && y1 + y >= 0 && y1 + y < height) {
          var d = ds[i][0];
          idx = index + x1 + (y1 * width);
          idx *= 3;

          data[idx] = Math.max(0, Math.min(255, data[idx] + er * d));
          data[idx + 1] = Math.max(0, Math.min(255, data[idx + 1] + eg * d));
          data[idx + 2] = Math.max(0, Math.min(255, data[idx + 2] + eb * d));
        }
      }
    }
  }
};

/*
  Returns index of palette color closest to c
*/
GIFEncoder.prototype.findClosest = function(c, used) {
  return this.findClosestRGB((c & 0xFF0000) >> 16, (c & 0x00FF00) >> 8, (c & 0x0000FF), used);
};

GIFEncoder.prototype.findClosestRGB = function(r, g, b, used) {
  if (this.colorTab === null) return -1;

  if (this.neuQuant && !used) {
    return this.neuQuant.lookupRGB(r, g, b);
  }
  
  var minpos = 0;
  var dmin = 256 * 256 * 256;
  var len = this.colorTab.length;

  for (var i = 0, index = 0; i < len; index++) {
    var dr = r - (this.colorTab[i++] & 0xff);
    var dg = g - (this.colorTab[i++] & 0xff);
    var db = b - (this.colorTab[i++] & 0xff);
    var d = dr * dr + dg * dg + db * db;
    if ((!used || this.usedEntry[index]) && (d < dmin)) {
      dmin = d;
      minpos = index;
    }
  }

  return minpos;
};

/*
  Extracts image pixels into byte array pixels
  (removes alphachannel from canvas imagedata)
*/
GIFEncoder.prototype.getImagePixels = function() {
  var w = this.width;
  var h = this.height;
  this.pixels = new Uint8Array(w * h * 3);

  var data = this.image;
  var srcPos = 0;
  var count = 0;

  for (var i = 0; i < h; i++) {
    for (var j = 0; j < w; j++) {
      this.pixels[count++] = data[srcPos++];
      this.pixels[count++] = data[srcPos++];
      this.pixels[count++] = data[srcPos++];
      srcPos++;
    }
  }
};

/*
  Writes Graphic Control Extension
*/
GIFEncoder.prototype.writeGraphicCtrlExt = function() {
  this.out.writeByte(0x21); // extension introducer
  this.out.writeByte(0xf9); // GCE label
  this.out.writeByte(4); // data block size

  var transp, disp;
  if (this.transparent === null) {
    transp = 0;
    disp = 0; // dispose = no action
  } else {
    transp = 1;
    disp = 2; // force clear if using transparent color
  }

  if (this.dispose >= 0) {
    disp = dispose & 7; // user override
  }
  disp <<= 2;

  // packed fields
  this.out.writeByte(
    0 | // 1:3 reserved
    disp | // 4:6 disposal
    0 | // 7 user input - 0 = none
    transp // 8 transparency flag
  );

  this.writeShort(this.delay); // delay x 1/100 sec
  this.out.writeByte(this.transIndex); // transparent color index
  this.out.writeByte(0); // block terminator
};

/*
  Writes Image Descriptor
*/
GIFEncoder.prototype.writeImageDesc = function() {
  this.out.writeByte(0x2c); // image separator
  this.writeShort(0); // image position x,y = 0,0
  this.writeShort(0);
  this.writeShort(this.width); // image size
  this.writeShort(this.height);

  // packed fields
  if (this.firstFrame || this.globalPalette) {
    // no LCT - GCT is used for first (or only) frame
    this.out.writeByte(0);
  } else {
    // specify normal LCT
    this.out.writeByte(
      0x80 | // 1 local color table 1=yes
      0 | // 2 interlace - 0=no
      0 | // 3 sorted - 0=no
      0 | // 4-5 reserved
      this.palSize // 6-8 size of color table
    );
  }
};

/*
  Writes Logical Screen Descriptor
*/
GIFEncoder.prototype.writeLSD = function() {
  // logical screen size
  this.writeShort(this.width);
  this.writeShort(this.height);

  // packed fields
  this.out.writeByte(
    0x80 | // 1 : global color table flag = 1 (gct used)
    0x70 | // 2-4 : color resolution = 7
    0x00 | // 5 : gct sort flag = 0
    this.palSize // 6-8 : gct size
  );

  this.out.writeByte(0); // background color index
  this.out.writeByte(0); // pixel aspect ratio - assume 1:1
};

/*
  Writes Netscape application extension to define repeat count.
*/
GIFEncoder.prototype.writeNetscapeExt = function() {
  this.out.writeByte(0x21); // extension introducer
  this.out.writeByte(0xff); // app extension label
  this.out.writeByte(11); // block size
  this.out.writeUTFBytes('NETSCAPE2.0'); // app id + auth code
  this.out.writeByte(3); // sub-block size
  this.out.writeByte(1); // loop sub-block id
  this.writeShort(this.repeat); // loop count (extra iterations, 0=repeat forever)
  this.out.writeByte(0); // block terminator
};

/*
  Writes color table
*/
GIFEncoder.prototype.writePalette = function() {
  this.out.writeBytes(this.colorTab);
  var n = (3 * 256) - this.colorTab.length;
  for (var i = 0; i < n; i++)
    this.out.writeByte(0);
};

GIFEncoder.prototype.writeShort = function(pValue) {
  this.out.writeByte(pValue & 0xFF);
  this.out.writeByte((pValue >> 8) & 0xFF);
};

/*
  Encodes and writes pixel data
*/
GIFEncoder.prototype.writePixels = function() {
  var enc = new LZWEncoder_1(this.width, this.height, this.indexedPixels, this.colorDepth);
  enc.encode(this.out);
};

/*
  Retrieves the GIF stream
*/
GIFEncoder.prototype.stream = function() {
  return this.out;
};

var GIFEncoder_1 = GIFEncoder;

/*     _    ___  _
      (_)  / __)(_)
  ____ _ _| |__  _  ___
 / _  | (_   __)| |/___)
( (_| | | | | _ | |___ |
 \___ |_| |_|(_)| (___/
(_____|       (_*/

var gif_js = {
  NeuQuant: NeuQuant_1,
  TypedNeuQuant: TypedNeuQuant,
  GIFEncoder: GIFEncoder_1,
  LZWEncoder: LZWEncoder_1
};

/* eslint-disable camelcase */
/* eslint-disable eqeqeq */
const QRErrorCorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };

const QRMaskPattern = {
  PATTERN000: 0,
  PATTERN001: 1,
  PATTERN010: 2,
  PATTERN011: 3,
  PATTERN100: 4,
  PATTERN101: 5,
  PATTERN110: 6,
  PATTERN111: 7
};

const QRMode = {
  MODE_NUMBER: 1 << 0,
  MODE_ALPHA_NUM: 1 << 1,
  MODE_8BIT_BYTE: 1 << 2,
  MODE_KANJI: 1 << 3
};

const QRMath = {
  glog: function(n) {
    if (n < 1) {
      throw new Error('glog(' + n + ')');
    }
    return QRMath.LOG_TABLE[n];
  },
  gexp: function(n) {
    while (n < 0) {
      n += 255;
    }
    while (n >= 256) {
      n -= 255;
    }
    return QRMath.EXP_TABLE[n];
  },
  EXP_TABLE: new Array(256),
  LOG_TABLE: new Array(256)
};

for (let i = 0; i < 8; i++) {
  QRMath.EXP_TABLE[i] = 1 << i;
}

for (let i = 8; i < 256; i++) {
  QRMath.EXP_TABLE[i] =
    QRMath.EXP_TABLE[i - 4] ^
    QRMath.EXP_TABLE[i - 5] ^
    QRMath.EXP_TABLE[i - 6] ^
    QRMath.EXP_TABLE[i - 8];
}

for (let i = 0; i < 255; i++) {
  QRMath.LOG_TABLE[QRMath.EXP_TABLE[i]] = i;
}

function QRPolynomial(num, shift) {
  if (num.length == undefined) {
    throw new Error(num.length + '/' + shift);
  }
  var offset = 0;
  while (offset < num.length && num[offset] == 0) {
    offset++;
  }
  this.num = new Array(num.length - offset + shift);
  for (var i = 0; i < num.length - offset; i++) {
    this.num[i] = num[i + offset];
  }
}

QRPolynomial.prototype = {
  get: function(index) {
    return this.num[index];
  },
  getLength: function() {
    return this.num.length;
  },
  multiply: function(e) {
    var num = new Array(this.getLength() + e.getLength() - 1);
    for (var i = 0; i < this.getLength(); i++) {
      for (var j = 0; j < e.getLength(); j++) {
        num[i + j] ^= QRMath.gexp(
          QRMath.glog(this.get(i)) + QRMath.glog(e.get(j))
        );
      }
    }
    return new QRPolynomial(num, 0);
  },
  mod: function(e) {
    if (this.getLength() - e.getLength() < 0) {
      return this;
    }
    var ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
    var num = new Array(this.getLength());
    for (let i = 0; i < this.getLength(); i++) {
      num[i] = this.get(i);
    }
    for (let i = 0; i < e.getLength(); i++) {
      num[i] ^= QRMath.gexp(QRMath.glog(e.get(i)) + ratio);
    }
    return new QRPolynomial(num, 0).mod(e);
  }
};

const QRUtil = {
  PATTERN_POSITION_TABLE: [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66],
    [6, 26, 48, 70],
    [6, 26, 50, 74],
    [6, 30, 54, 78],
    [6, 30, 56, 82],
    [6, 30, 58, 86],
    [6, 34, 62, 90],
    [6, 28, 50, 72, 94],
    [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106],
    [6, 32, 58, 84, 110],
    [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138],
    [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158],
    [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170]
  ],
  G15:
    (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0),
  G18:
    (1 << 12) |
    (1 << 11) |
    (1 << 10) |
    (1 << 9) |
    (1 << 8) |
    (1 << 5) |
    (1 << 2) |
    (1 << 0),
  G15_MASK: (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1),
  getBCHTypeInfo: function(data) {
    var d = data << 10;
    while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15) >= 0) {
      d ^=
        QRUtil.G15 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G15));
    }
    return ((data << 10) | d) ^ QRUtil.G15_MASK;
  },
  getBCHTypeNumber: function(data) {
    var d = data << 12;
    while (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18) >= 0) {
      d ^=
        QRUtil.G18 << (QRUtil.getBCHDigit(d) - QRUtil.getBCHDigit(QRUtil.G18));
    }
    return (data << 12) | d;
  },
  getBCHDigit: function(data) {
    var digit = 0;
    while (data != 0) {
      digit++;
      data >>>= 1;
    }
    return digit;
  },
  getPatternPosition: function(typeNumber) {
    return QRUtil.PATTERN_POSITION_TABLE[typeNumber - 1];
  },
  getMask: function(maskPattern, i, j) {
    switch (maskPattern) {
      case QRMaskPattern.PATTERN000:
        return (i + j) % 2 == 0;
      case QRMaskPattern.PATTERN001:
        return i % 2 == 0;
      case QRMaskPattern.PATTERN010:
        return j % 3 == 0;
      case QRMaskPattern.PATTERN011:
        return (i + j) % 3 == 0;
      case QRMaskPattern.PATTERN100:
        return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
      case QRMaskPattern.PATTERN101:
        return (i * j) % 2 + (i * j) % 3 == 0;
      case QRMaskPattern.PATTERN110:
        return ((i * j) % 2 + (i * j) % 3) % 2 == 0;
      case QRMaskPattern.PATTERN111:
        return ((i * j) % 3 + (i + j) % 2) % 2 == 0;
      default:
        throw new Error('bad maskPattern:' + maskPattern);
    }
  },
  getErrorCorrectPolynomial: function(errorCorrectLength) {
    var a = new QRPolynomial([1], 0);
    for (var i = 0; i < errorCorrectLength; i++) {
      a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
    }
    return a;
  },
  getLengthInBits: function(mode, type) {
    if (type >= 1 && type < 10) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 10;
        case QRMode.MODE_ALPHA_NUM:
          return 9;
        case QRMode.MODE_8BIT_BYTE:
          return 8;
        case QRMode.MODE_KANJI:
          return 8;
        default:
          throw new Error('mode:' + mode);
      }
    } else if (type < 27) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 12;
        case QRMode.MODE_ALPHA_NUM:
          return 11;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 10;
        default:
          throw new Error('mode:' + mode);
      }
    } else if (type < 41) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 14;
        case QRMode.MODE_ALPHA_NUM:
          return 13;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 12;
        default:
          throw new Error('mode:' + mode);
      }
    } else {
      throw new Error('type:' + type);
    }
  },
  getLostPoint: function(qrCode) {
    var moduleCount = qrCode.getModuleCount();
    var lostPoint = 0;
    for (var row = 0; row < moduleCount; row++) {
      for (var col = 0; col < moduleCount; col++) {
        var sameCount = 0;
        var dark = qrCode.isDark(row, col);
        for (var r = -1; r <= 1; r++) {
          if (row + r < 0 || moduleCount <= row + r) {
            continue;
          }
          for (var c = -1; c <= 1; c++) {
            if (col + c < 0 || moduleCount <= col + c) {
              continue;
            }
            if (r == 0 && c == 0) {
              continue;
            }
            if (dark == qrCode.isDark(row + r, col + c)) {
              sameCount++;
            }
          }
        }
        if (sameCount > 5) {
          lostPoint += 3 + sameCount - 5;
        }
      }
    }
    for (let row = 0; row < moduleCount - 1; row++) {
      for (let col = 0; col < moduleCount - 1; col++) {
        var count = 0;
        if (qrCode.isDark(row, col)) count++;
        if (qrCode.isDark(row + 1, col)) count++;
        if (qrCode.isDark(row, col + 1)) count++;
        if (qrCode.isDark(row + 1, col + 1)) count++;
        if (count == 0 || count == 4) {
          lostPoint += 3;
        }
      }
    }
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount - 6; col++) {
        if (
          qrCode.isDark(row, col) &&
          !qrCode.isDark(row, col + 1) &&
          qrCode.isDark(row, col + 2) &&
          qrCode.isDark(row, col + 3) &&
          qrCode.isDark(row, col + 4) &&
          !qrCode.isDark(row, col + 5) &&
          qrCode.isDark(row, col + 6)
        ) {
          lostPoint += 40;
        }
      }
    }
    for (let col = 0; col < moduleCount; col++) {
      for (let row = 0; row < moduleCount - 6; row++) {
        if (
          qrCode.isDark(row, col) &&
          !qrCode.isDark(row + 1, col) &&
          qrCode.isDark(row + 2, col) &&
          qrCode.isDark(row + 3, col) &&
          qrCode.isDark(row + 4, col) &&
          !qrCode.isDark(row + 5, col) &&
          qrCode.isDark(row + 6, col)
        ) {
          lostPoint += 40;
        }
      }
    }
    var darkCount = 0;
    for (let col = 0; col < moduleCount; col++) {
      for (let row = 0; row < moduleCount; row++) {
        if (qrCode.isDark(row, col)) {
          darkCount++;
        }
      }
    }
    var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
    lostPoint += ratio * 10;
    return lostPoint;
  }
};

function QRBitBuffer() {
  this.buffer = [];
  this.length = 0;
}

QRBitBuffer.prototype = {
  get: function(index) {
    var bufIndex = Math.floor(index / 8);
    return ((this.buffer[bufIndex] >>> (7 - index % 8)) & 1) == 1;
  },
  put: function(num, length) {
    for (var i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) == 1);
    }
  },
  getLengthInBits: function() {
    return this.length;
  },
  putBit: function(bit) {
    var bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
    }
    this.length++;
  }
};

function QR8bitByte(data) {
  this.mode = QRMode.MODE_8BIT_BYTE;
  this.data = data;
  this.parsedData = [];
  for (var i = 0, l = this.data.length; i < l; i++) {
    var byteArray = [];
    var code = this.data.charCodeAt(i);
    if (code > 0x10000) {
      byteArray[0] = 0xf0 | ((code & 0x1c0000) >>> 18);
      byteArray[1] = 0x80 | ((code & 0x3f000) >>> 12);
      byteArray[2] = 0x80 | ((code & 0xfc0) >>> 6);
      byteArray[3] = 0x80 | (code & 0x3f);
    } else if (code > 0x800) {
      byteArray[0] = 0xe0 | ((code & 0xf000) >>> 12);
      byteArray[1] = 0x80 | ((code & 0xfc0) >>> 6);
      byteArray[2] = 0x80 | (code & 0x3f);
    } else if (code > 0x80) {
      byteArray[0] = 0xc0 | ((code & 0x7c0) >>> 6);
      byteArray[1] = 0x80 | (code & 0x3f);
    } else {
      byteArray[0] = code;
    }
    this.parsedData.push(byteArray);
  }
  this.parsedData = Array.prototype.concat.apply([], this.parsedData);
  if (this.parsedData.length !== this.data.length) {
    this.parsedData.unshift(191);
    this.parsedData.unshift(187);
    this.parsedData.unshift(239);
  }
}

QR8bitByte.prototype = {
  getLength: function(buffer) {
    return this.parsedData.length;
  },
  write: function(buffer) {
    for (var i = 0, l = this.parsedData.length; i < l; i++) {
      buffer.put(this.parsedData[i], 8);
    }
  }
};

function QRRSBlock(totalCount, dataCount) {
  this.totalCount = totalCount;
  this.dataCount = dataCount;
}

QRRSBlock.RS_BLOCK_TABLE = [
  [1, 26, 19],
  [1, 26, 16],
  [1, 26, 13],
  [1, 26, 9],
  [1, 44, 34],
  [1, 44, 28],
  [1, 44, 22],
  [1, 44, 16],
  [1, 70, 55],
  [1, 70, 44],
  [2, 35, 17],
  [2, 35, 13],
  [1, 100, 80],
  [2, 50, 32],
  [2, 50, 24],
  [4, 25, 9],
  [1, 134, 108],
  [2, 67, 43],
  [2, 33, 15, 2, 34, 16],
  [2, 33, 11, 2, 34, 12],
  [2, 86, 68],
  [4, 43, 27],
  [4, 43, 19],
  [4, 43, 15],
  [2, 98, 78],
  [4, 49, 31],
  [2, 32, 14, 4, 33, 15],
  [4, 39, 13, 1, 40, 14],
  [2, 121, 97],
  [2, 60, 38, 2, 61, 39],
  [4, 40, 18, 2, 41, 19],
  [4, 40, 14, 2, 41, 15],
  [2, 146, 116],
  [3, 58, 36, 2, 59, 37],
  [4, 36, 16, 4, 37, 17],
  [4, 36, 12, 4, 37, 13],
  [2, 86, 68, 2, 87, 69],
  [4, 69, 43, 1, 70, 44],
  [6, 43, 19, 2, 44, 20],
  [6, 43, 15, 2, 44, 16],
  [4, 101, 81],
  [1, 80, 50, 4, 81, 51],
  [4, 50, 22, 4, 51, 23],
  [3, 36, 12, 8, 37, 13],
  [2, 116, 92, 2, 117, 93],
  [6, 58, 36, 2, 59, 37],
  [4, 46, 20, 6, 47, 21],
  [7, 42, 14, 4, 43, 15],
  [4, 133, 107],
  [8, 59, 37, 1, 60, 38],
  [8, 44, 20, 4, 45, 21],
  [12, 33, 11, 4, 34, 12],
  [3, 145, 115, 1, 146, 116],
  [4, 64, 40, 5, 65, 41],
  [11, 36, 16, 5, 37, 17],
  [11, 36, 12, 5, 37, 13],
  [5, 109, 87, 1, 110, 88],
  [5, 65, 41, 5, 66, 42],
  [5, 54, 24, 7, 55, 25],
  [11, 36, 12],
  [5, 122, 98, 1, 123, 99],
  [7, 73, 45, 3, 74, 46],
  [15, 43, 19, 2, 44, 20],
  [3, 45, 15, 13, 46, 16],
  [1, 135, 107, 5, 136, 108],
  [10, 74, 46, 1, 75, 47],
  [1, 50, 22, 15, 51, 23],
  [2, 42, 14, 17, 43, 15],
  [5, 150, 120, 1, 151, 121],
  [9, 69, 43, 4, 70, 44],
  [17, 50, 22, 1, 51, 23],
  [2, 42, 14, 19, 43, 15],
  [3, 141, 113, 4, 142, 114],
  [3, 70, 44, 11, 71, 45],
  [17, 47, 21, 4, 48, 22],
  [9, 39, 13, 16, 40, 14],
  [3, 135, 107, 5, 136, 108],
  [3, 67, 41, 13, 68, 42],
  [15, 54, 24, 5, 55, 25],
  [15, 43, 15, 10, 44, 16],
  [4, 144, 116, 4, 145, 117],
  [17, 68, 42],
  [17, 50, 22, 6, 51, 23],
  [19, 46, 16, 6, 47, 17],
  [2, 139, 111, 7, 140, 112],
  [17, 74, 46],
  [7, 54, 24, 16, 55, 25],
  [34, 37, 13],
  [4, 151, 121, 5, 152, 122],
  [4, 75, 47, 14, 76, 48],
  [11, 54, 24, 14, 55, 25],
  [16, 45, 15, 14, 46, 16],
  [6, 147, 117, 4, 148, 118],
  [6, 73, 45, 14, 74, 46],
  [11, 54, 24, 16, 55, 25],
  [30, 46, 16, 2, 47, 17],
  [8, 132, 106, 4, 133, 107],
  [8, 75, 47, 13, 76, 48],
  [7, 54, 24, 22, 55, 25],
  [22, 45, 15, 13, 46, 16],
  [10, 142, 114, 2, 143, 115],
  [19, 74, 46, 4, 75, 47],
  [28, 50, 22, 6, 51, 23],
  [33, 46, 16, 4, 47, 17],
  [8, 152, 122, 4, 153, 123],
  [22, 73, 45, 3, 74, 46],
  [8, 53, 23, 26, 54, 24],
  [12, 45, 15, 28, 46, 16],
  [3, 147, 117, 10, 148, 118],
  [3, 73, 45, 23, 74, 46],
  [4, 54, 24, 31, 55, 25],
  [11, 45, 15, 31, 46, 16],
  [7, 146, 116, 7, 147, 117],
  [21, 73, 45, 7, 74, 46],
  [1, 53, 23, 37, 54, 24],
  [19, 45, 15, 26, 46, 16],
  [5, 145, 115, 10, 146, 116],
  [19, 75, 47, 10, 76, 48],
  [15, 54, 24, 25, 55, 25],
  [23, 45, 15, 25, 46, 16],
  [13, 145, 115, 3, 146, 116],
  [2, 74, 46, 29, 75, 47],
  [42, 54, 24, 1, 55, 25],
  [23, 45, 15, 28, 46, 16],
  [17, 145, 115],
  [10, 74, 46, 23, 75, 47],
  [10, 54, 24, 35, 55, 25],
  [19, 45, 15, 35, 46, 16],
  [17, 145, 115, 1, 146, 116],
  [14, 74, 46, 21, 75, 47],
  [29, 54, 24, 19, 55, 25],
  [11, 45, 15, 46, 46, 16],
  [13, 145, 115, 6, 146, 116],
  [14, 74, 46, 23, 75, 47],
  [44, 54, 24, 7, 55, 25],
  [59, 46, 16, 1, 47, 17],
  [12, 151, 121, 7, 152, 122],
  [12, 75, 47, 26, 76, 48],
  [39, 54, 24, 14, 55, 25],
  [22, 45, 15, 41, 46, 16],
  [6, 151, 121, 14, 152, 122],
  [6, 75, 47, 34, 76, 48],
  [46, 54, 24, 10, 55, 25],
  [2, 45, 15, 64, 46, 16],
  [17, 152, 122, 4, 153, 123],
  [29, 74, 46, 14, 75, 47],
  [49, 54, 24, 10, 55, 25],
  [24, 45, 15, 46, 46, 16],
  [4, 152, 122, 18, 153, 123],
  [13, 74, 46, 32, 75, 47],
  [48, 54, 24, 14, 55, 25],
  [42, 45, 15, 32, 46, 16],
  [20, 147, 117, 4, 148, 118],
  [40, 75, 47, 7, 76, 48],
  [43, 54, 24, 22, 55, 25],
  [10, 45, 15, 67, 46, 16],
  [19, 148, 118, 6, 149, 119],
  [18, 75, 47, 31, 76, 48],
  [34, 54, 24, 34, 55, 25],
  [20, 45, 15, 61, 46, 16]
];

QRRSBlock.getRSBlocks = function(typeNumber, errorCorrectLevel) {
  var rsBlock = QRRSBlock.getRsBlockTable(typeNumber, errorCorrectLevel);
  if (!rsBlock) {
    throw new Error(
      'bad rs block @ typeNumber:' +
        typeNumber +
        '/errorCorrectLevel:' +
        errorCorrectLevel
    );
  }
  var length = rsBlock.length / 3;
  var list = [];
  for (var i = 0; i < length; i++) {
    var count = rsBlock[i * 3 + 0];
    var totalCount = rsBlock[i * 3 + 1];
    var dataCount = rsBlock[i * 3 + 2];
    for (var j = 0; j < count; j++) {
      list.push(new QRRSBlock(totalCount, dataCount));
    }
  }
  return list;
};

QRRSBlock.getRsBlockTable = function(typeNumber, errorCorrectLevel) {
  switch (errorCorrectLevel) {
    case QRErrorCorrectLevel.L:
      return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
    case QRErrorCorrectLevel.M:
      return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
    case QRErrorCorrectLevel.Q:
      return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
    case QRErrorCorrectLevel.H:
      return QRRSBlock.RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
    default:
      return undefined;
  }
};

/* eslint-disable camelcase */
/* eslint-disable eqeqeq */
function QRCodeModel(typeNumber, errorCorrectLevel) {
  this.typeNumber = typeNumber;
  this.errorCorrectLevel = errorCorrectLevel;
  this.modules = null;
  this.moduleCount = 0;
  this.dataCache = null;
  this.dataList = [];
}

QRCodeModel.prototype = {
  addData: function(data) {
    var newData = new QR8bitByte(data);
    this.dataList.push(newData);
    this.dataCache = null;
  },
  isDark: function(row, col) {
    if (
      row < 0 ||
      this.moduleCount <= row ||
      col < 0 ||
      this.moduleCount <= col
    ) {
      throw new Error(row + ',' + col);
    }
    return this.modules[row][col];
  },
  getModuleCount: function() {
    return this.moduleCount;
  },
  make: function() {
    if (this.typeNumber < 1) {
      var typeNumber = 1;
      for (typeNumber = 1; typeNumber < 40; typeNumber++) {
        var rsBlocks = QRRSBlock.getRSBlocks(
          typeNumber,
          this.errorCorrectLevel
        );

        var buffer = new QRBitBuffer();
        var totalDataCount = 0;
        for (let i = 0; i < rsBlocks.length; i++) {
          totalDataCount += rsBlocks[i].dataCount;
        }

        for (let i = 0; i < this.dataList.length; i++) {
          var data = this.dataList[i];
          buffer.put(data.mode, 4);
          buffer.put(
            data.getLength(),
            QRUtil.getLengthInBits(data.mode, typeNumber)
          );
          data.write(buffer);
        }
        if (buffer.getLengthInBits() <= totalDataCount * 8) break;
      }
      this.typeNumber = typeNumber;
    }
    this.makeImpl(!1, this.getBestMaskPattern());
  },
  makeImpl: function(test, maskPattern) {
    this.moduleCount = this.typeNumber * 4 + 17;
    this.modules = new Array(this.moduleCount);
    for (var row = 0; row < this.moduleCount; row++) {
      this.modules[row] = new Array(this.moduleCount);
      for (var col = 0; col < this.moduleCount; col++) {
        this.modules[row][col] = null;
      }
    }
    this.setupPositionProbePattern(0, 0);
    this.setupPositionProbePattern(this.moduleCount - 7, 0);
    this.setupPositionProbePattern(0, this.moduleCount - 7);
    this.setupPositionAdjustPattern();
    this.setupTimingPattern();
    this.setupTypeInfo(test, maskPattern);
    if (this.typeNumber >= 7) {
      this.setupTypeNumber(test);
    }
    if (this.dataCache == null) {
      this.dataCache = QRCodeModel.createData(
        this.typeNumber,
        this.errorCorrectLevel,
        this.dataList
      );
    }
    this.mapData(this.dataCache, maskPattern);
  },
  setupPositionProbePattern: function(row, col) {
    for (var r = -1; r <= 7; r++) {
      if (row + r <= -1 || this.moduleCount <= row + r) continue;
      for (var c = -1; c <= 7; c++) {
        if (col + c <= -1 || this.moduleCount <= col + c) continue;
        if (
          (r >= 0 && r <= 6 && (c == 0 || c == 6)) ||
          (c >= 0 && c <= 6 && (r == 0 || r == 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        ) {
          this.modules[row + r][col + c] = !0;
        } else {
          this.modules[row + r][col + c] = !1;
        }
      }
    }
  },
  getBestMaskPattern: function() {
    var minLostPoint = 0;
    var pattern = 0;
    for (var i = 0; i < 8; i++) {
      this.makeImpl(!0, i);
      var lostPoint = QRUtil.getLostPoint(this);
      if (i == 0 || minLostPoint > lostPoint) {
        minLostPoint = lostPoint;
        pattern = i;
      }
    }
    return pattern;
  },
  createMovieClip: function(target_mc, instance_name, depth) {
    var qr_mc = target_mc.createEmptyMovieClip(instance_name, depth);
    var cs = 1;
    this.make();
    for (var row = 0; row < this.modules.length; row++) {
      var y = row * cs;
      for (var col = 0; col < this.modules[row].length; col++) {
        var x = col * cs;
        var dark = this.modules[row][col];
        if (dark) {
          qr_mc.beginFill(0, 100);
          qr_mc.moveTo(x, y);
          qr_mc.lineTo(x + cs, y);
          qr_mc.lineTo(x + cs, y + cs);
          qr_mc.lineTo(x, y + cs);
          qr_mc.endFill();
        }
      }
    }
    return qr_mc;
  },
  setupTimingPattern: function() {
    for (var r = 8; r < this.moduleCount - 8; r++) {
      if (this.modules[r][6] != null) {
        continue;
      }
      this.modules[r][6] = r % 2 == 0;
    }
    for (var c = 8; c < this.moduleCount - 8; c++) {
      if (this.modules[6][c] != null) {
        continue;
      }
      this.modules[6][c] = c % 2 == 0;
    }
  },
  setupPositionAdjustPattern: function() {
    var pos = QRUtil.getPatternPosition(this.typeNumber);
    for (var i = 0; i < pos.length; i++) {
      for (var j = 0; j < pos.length; j++) {
        var row = pos[i];
        var col = pos[j];
        if (this.modules[row][col] != null) {
          continue;
        }
        for (var r = -2; r <= 2; r++) {
          for (var c = -2; c <= 2; c++) {
            if (r == -2 || r == 2 || c == -2 || c == 2 || (r == 0 && c == 0)) {
              this.modules[row + r][col + c] = !0;
            } else {
              this.modules[row + r][col + c] = !1;
            }
          }
        }
      }
    }
  },
  setupTypeNumber: function(test) {
    var bits = QRUtil.getBCHTypeNumber(this.typeNumber);
    for (let i = 0; i < 18; i++) {
      let mod = !test && ((bits >> i) & 1) == 1;
      this.modules[Math.floor(i / 3)][i % 3 + this.moduleCount - 8 - 3] = mod;
    }
    for (let i = 0; i < 18; i++) {
      let mod = !test && ((bits >> i) & 1) == 1;
      this.modules[i % 3 + this.moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  },
  setupTypeInfo: function(test, maskPattern) {
    var data = (this.errorCorrectLevel << 3) | maskPattern;
    var bits = QRUtil.getBCHTypeInfo(data);
    for (let i = 0; i < 15; i++) {
      let mod = !test && ((bits >> i) & 1) == 1;
      if (i < 6) {
        this.modules[i][8] = mod;
      } else if (i < 8) {
        this.modules[i + 1][8] = mod;
      } else {
        this.modules[this.moduleCount - 15 + i][8] = mod;
      }
    }
    for (let i = 0; i < 15; i++) {
      let mod = !test && ((bits >> i) & 1) == 1;
      if (i < 8) {
        this.modules[8][this.moduleCount - i - 1] = mod;
      } else if (i < 9) {
        this.modules[8][15 - i - 1 + 1] = mod;
      } else {
        this.modules[8][15 - i - 1] = mod;
      }
    }
    this.modules[this.moduleCount - 8][8] = !test;
  },
  mapData: function(data, maskPattern) {
    var inc = -1;
    var row = this.moduleCount - 1;
    var bitIndex = 7;
    var byteIndex = 0;
    for (var col = this.moduleCount - 1; col > 0; col -= 2) {
      if (col == 6) col--;
      while (!0) {
        for (var c = 0; c < 2; c++) {
          if (this.modules[row][col - c] == null) {
            var dark = !1;
            if (byteIndex < data.length) {
              dark = ((data[byteIndex] >>> bitIndex) & 1) == 1;
            }
            var mask = QRUtil.getMask(maskPattern, row, col - c);
            if (mask) {
              dark = !dark;
            }
            this.modules[row][col - c] = dark;
            bitIndex--;
            if (bitIndex == -1) {
              byteIndex++;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || this.moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  }
};

QRCodeModel.PAD0 = 0xec;
QRCodeModel.PAD1 = 0x11;

QRCodeModel.createData = function(typeNumber, errorCorrectLevel, dataList) {
  var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
  var buffer = new QRBitBuffer();
  for (let i = 0; i < dataList.length; i++) {
    let data = dataList[i];
    buffer.put(data.mode, 4);
    buffer.put(data.getLength(), QRUtil.getLengthInBits(data.mode, typeNumber));
    data.write(buffer);
  }
  var totalDataCount = 0;
  for (let i = 0; i < rsBlocks.length; i++) {
    totalDataCount += rsBlocks[i].dataCount;
  }
  if (buffer.getLengthInBits() > totalDataCount * 8) {
    throw new Error(
      'code length overflow. (' +
        buffer.getLengthInBits() +
        '>' +
        totalDataCount * 8 +
        ')'
    );
  }
  if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
    buffer.put(0, 4);
  }
  while (buffer.getLengthInBits() % 8 != 0) {
    buffer.putBit(!1);
  }
  while (!0) {
    if (buffer.getLengthInBits() >= totalDataCount * 8) {
      break;
    }
    buffer.put(QRCodeModel.PAD0, 8);
    if (buffer.getLengthInBits() >= totalDataCount * 8) {
      break;
    }
    buffer.put(QRCodeModel.PAD1, 8);
  }
  return QRCodeModel.createBytes(buffer, rsBlocks);
};

QRCodeModel.createBytes = function(buffer, rsBlocks) {
  var offset = 0;
  var maxDcCount = 0;
  var maxEcCount = 0;
  var dcdata = new Array(rsBlocks.length);
  var ecdata = new Array(rsBlocks.length);
  for (var r = 0; r < rsBlocks.length; r++) {
    var dcCount = rsBlocks[r].dataCount;
    var ecCount = rsBlocks[r].totalCount - dcCount;
    maxDcCount = Math.max(maxDcCount, dcCount);
    maxEcCount = Math.max(maxEcCount, ecCount);
    dcdata[r] = new Array(dcCount);
    for (var i = 0; i < dcdata[r].length; i++) {
      dcdata[r][i] = 0xff & buffer.buffer[i + offset];
    }
    offset += dcCount;
    var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
    var rawPoly = new QRPolynomial(dcdata[r], rsPoly.getLength() - 1);
    var modPoly = rawPoly.mod(rsPoly);
    ecdata[r] = new Array(rsPoly.getLength() - 1);
    for (let i = 0; i < ecdata[r].length; i++) {
      var modIndex = i + modPoly.getLength() - ecdata[r].length;
      ecdata[r][i] = modIndex >= 0 ? modPoly.get(modIndex) : 0;
    }
  }
  var totalCodeCount = 0;
  for (let i = 0; i < rsBlocks.length; i++) {
    totalCodeCount += rsBlocks[i].totalCount;
  }
  var data = new Array(totalCodeCount);
  var index = 0;
  for (let i = 0; i < maxDcCount; i++) {
    for (let r = 0; r < rsBlocks.length; r++) {
      if (i < dcdata[r].length) {
        data[index++] = dcdata[r][i];
      }
    }
  }
  for (let i = 0; i < maxEcCount; i++) {
    for (let r = 0; r < rsBlocks.length; r++) {
      if (i < ecdata[r].length) {
        data[index++] = ecdata[r][i];
      }
    }
  }
  return data;
};

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
        gifOutput = new gif_js({
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

return AwesomeQRCode;

})));
