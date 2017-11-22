/* eslint-disable camelcase */
/* eslint-disable eqeqeq */
import DataParser from './DataParser';
import Parsers from './Parsers';

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

export default GIF;
