var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/global/window.js
var require_window = __commonJS({
  "node_modules/global/window.js"(exports, module) {
    var win;
    if (typeof window !== "undefined") {
      win = window;
    } else if (typeof global !== "undefined") {
      win = global;
    } else if (typeof self !== "undefined") {
      win = self;
    } else {
      win = {};
    }
    module.exports = win;
  }
});

// node_modules/mux.js/dist/mux.js
var require_mux = __commonJS({
  "node_modules/mux.js/dist/mux.js"(exports, module) {
    (function(global2, factory) {
      typeof exports === "object" && typeof module !== "undefined" ? module.exports = factory(require_window()) : typeof define === "function" && define.amd ? define(["global/window"], factory) : (global2 = typeof globalThis !== "undefined" ? globalThis : global2 || self, global2.muxjs = factory(global2.window));
    })(exports, (function(window2) {
      "use strict";
      function _interopDefaultLegacy(e) {
        return e && typeof e === "object" && "default" in e ? e : { "default": e };
      }
      __name(_interopDefaultLegacy, "_interopDefaultLegacy");
      var window__default = /* @__PURE__ */ _interopDefaultLegacy(window2);
      var Stream = /* @__PURE__ */ __name(function Stream2() {
        this.init = function() {
          var listeners = {};
          this.on = function(type2, listener) {
            if (!listeners[type2]) {
              listeners[type2] = [];
            }
            listeners[type2] = listeners[type2].concat(listener);
          };
          this.off = function(type2, listener) {
            var index;
            if (!listeners[type2]) {
              return false;
            }
            index = listeners[type2].indexOf(listener);
            listeners[type2] = listeners[type2].slice();
            listeners[type2].splice(index, 1);
            return index > -1;
          };
          this.trigger = function(type2) {
            var callbacks, i, length, args;
            callbacks = listeners[type2];
            if (!callbacks) {
              return;
            }
            if (arguments.length === 2) {
              length = callbacks.length;
              for (i = 0; i < length; ++i) {
                callbacks[i].call(this, arguments[1]);
              }
            } else {
              args = [];
              i = arguments.length;
              for (i = 1; i < arguments.length; ++i) {
                args.push(arguments[i]);
              }
              length = callbacks.length;
              for (i = 0; i < length; ++i) {
                callbacks[i].apply(this, args);
              }
            }
          };
          this.dispose = function() {
            listeners = {};
          };
        };
      }, "Stream");
      Stream.prototype.pipe = function(destination) {
        this.on("data", function(data) {
          destination.push(data);
        });
        this.on("done", function(flushSource) {
          destination.flush(flushSource);
        });
        this.on("partialdone", function(flushSource) {
          destination.partialFlush(flushSource);
        });
        this.on("endedtimeline", function(flushSource) {
          destination.endTimeline(flushSource);
        });
        this.on("reset", function(flushSource) {
          destination.reset(flushSource);
        });
        return destination;
      };
      Stream.prototype.push = function(data) {
        this.trigger("data", data);
      };
      Stream.prototype.flush = function(flushSource) {
        this.trigger("done", flushSource);
      };
      Stream.prototype.partialFlush = function(flushSource) {
        this.trigger("partialdone", flushSource);
      };
      Stream.prototype.endTimeline = function(flushSource) {
        this.trigger("endedtimeline", flushSource);
      };
      Stream.prototype.reset = function(flushSource) {
        this.trigger("reset", flushSource);
      };
      var stream = Stream;
      var ONE_SECOND_IN_TS$5 = 9e4, secondsToVideoTs, secondsToAudioTs, videoTsToSeconds, audioTsToSeconds, audioTsToVideoTs, videoTsToAudioTs, metadataTsToSeconds;
      secondsToVideoTs = /* @__PURE__ */ __name(function secondsToVideoTs2(seconds) {
        return seconds * ONE_SECOND_IN_TS$5;
      }, "secondsToVideoTs");
      secondsToAudioTs = /* @__PURE__ */ __name(function secondsToAudioTs2(seconds, sampleRate) {
        return seconds * sampleRate;
      }, "secondsToAudioTs");
      videoTsToSeconds = /* @__PURE__ */ __name(function videoTsToSeconds2(timestamp) {
        return timestamp / ONE_SECOND_IN_TS$5;
      }, "videoTsToSeconds");
      audioTsToSeconds = /* @__PURE__ */ __name(function audioTsToSeconds2(timestamp, sampleRate) {
        return timestamp / sampleRate;
      }, "audioTsToSeconds");
      audioTsToVideoTs = /* @__PURE__ */ __name(function audioTsToVideoTs2(timestamp, sampleRate) {
        return secondsToVideoTs(audioTsToSeconds(timestamp, sampleRate));
      }, "audioTsToVideoTs");
      videoTsToAudioTs = /* @__PURE__ */ __name(function videoTsToAudioTs2(timestamp, sampleRate) {
        return secondsToAudioTs(videoTsToSeconds(timestamp), sampleRate);
      }, "videoTsToAudioTs");
      metadataTsToSeconds = /* @__PURE__ */ __name(function metadataTsToSeconds2(timestamp, timelineStartPts, keepOriginalTimestamps) {
        return videoTsToSeconds(keepOriginalTimestamps ? timestamp : timestamp - timelineStartPts);
      }, "metadataTsToSeconds");
      var clock = {
        ONE_SECOND_IN_TS: ONE_SECOND_IN_TS$5,
        secondsToVideoTs,
        secondsToAudioTs,
        videoTsToSeconds,
        audioTsToSeconds,
        audioTsToVideoTs,
        videoTsToAudioTs,
        metadataTsToSeconds
      };
      var ONE_SECOND_IN_TS$4 = clock.ONE_SECOND_IN_TS;
      var _AdtsStream;
      var ADTS_SAMPLING_FREQUENCIES$1 = [96e3, 88200, 64e3, 48e3, 44100, 32e3, 24e3, 22050, 16e3, 12e3, 11025, 8e3, 7350];
      _AdtsStream = /* @__PURE__ */ __name(function AdtsStream(handlePartialSegments) {
        var buffer, frameNum = 0;
        _AdtsStream.prototype.init.call(this);
        this.skipWarn_ = function(start, end) {
          this.trigger("log", {
            level: "warn",
            message: "adts skiping bytes " + start + " to " + end + " in frame " + frameNum + " outside syncword"
          });
        };
        this.push = function(packet) {
          var i = 0, frameLength, protectionSkipBytes, oldBuffer, sampleCount, adtsFrameDuration;
          if (!handlePartialSegments) {
            frameNum = 0;
          }
          if (packet.type !== "audio") {
            return;
          }
          if (buffer && buffer.length) {
            oldBuffer = buffer;
            buffer = new Uint8Array(oldBuffer.byteLength + packet.data.byteLength);
            buffer.set(oldBuffer);
            buffer.set(packet.data, oldBuffer.byteLength);
          } else {
            buffer = packet.data;
          }
          var skip;
          while (i + 7 < buffer.length) {
            if (buffer[i] !== 255 || (buffer[i + 1] & 246) !== 240) {
              if (typeof skip !== "number") {
                skip = i;
              }
              i++;
              continue;
            }
            if (typeof skip === "number") {
              this.skipWarn_(skip, i);
              skip = null;
            }
            protectionSkipBytes = (~buffer[i + 1] & 1) * 2;
            frameLength = (buffer[i + 3] & 3) << 11 | buffer[i + 4] << 3 | (buffer[i + 5] & 224) >> 5;
            sampleCount = ((buffer[i + 6] & 3) + 1) * 1024;
            adtsFrameDuration = sampleCount * ONE_SECOND_IN_TS$4 / ADTS_SAMPLING_FREQUENCIES$1[(buffer[i + 2] & 60) >>> 2];
            if (buffer.byteLength - i < frameLength) {
              break;
            }
            this.trigger("data", {
              pts: packet.pts + frameNum * adtsFrameDuration,
              dts: packet.dts + frameNum * adtsFrameDuration,
              sampleCount,
              audioobjecttype: (buffer[i + 2] >>> 6 & 3) + 1,
              channelcount: (buffer[i + 2] & 1) << 2 | (buffer[i + 3] & 192) >>> 6,
              samplerate: ADTS_SAMPLING_FREQUENCIES$1[(buffer[i + 2] & 60) >>> 2],
              samplingfrequencyindex: (buffer[i + 2] & 60) >>> 2,
              // assume ISO/IEC 14496-12 AudioSampleEntry default of 16
              samplesize: 16,
              // data is the frame without it's header
              data: buffer.subarray(i + 7 + protectionSkipBytes, i + frameLength)
            });
            frameNum++;
            i += frameLength;
          }
          if (typeof skip === "number") {
            this.skipWarn_(skip, i);
            skip = null;
          }
          buffer = buffer.subarray(i);
        };
        this.flush = function() {
          frameNum = 0;
          this.trigger("done");
        };
        this.reset = function() {
          buffer = void 0;
          this.trigger("reset");
        };
        this.endTimeline = function() {
          buffer = void 0;
          this.trigger("endedtimeline");
        };
      }, "AdtsStream");
      _AdtsStream.prototype = new stream();
      var adts = _AdtsStream;
      var ExpGolomb;
      ExpGolomb = /* @__PURE__ */ __name(function ExpGolomb2(workingData) {
        var workingBytesAvailable = workingData.byteLength, workingWord = 0, workingBitsAvailable = 0;
        this.length = function() {
          return 8 * workingBytesAvailable;
        };
        this.bitsAvailable = function() {
          return 8 * workingBytesAvailable + workingBitsAvailable;
        };
        this.loadWord = function() {
          var position = workingData.byteLength - workingBytesAvailable, workingBytes = new Uint8Array(4), availableBytes = Math.min(4, workingBytesAvailable);
          if (availableBytes === 0) {
            throw new Error("no bytes available");
          }
          workingBytes.set(workingData.subarray(position, position + availableBytes));
          workingWord = new DataView(workingBytes.buffer).getUint32(0);
          workingBitsAvailable = availableBytes * 8;
          workingBytesAvailable -= availableBytes;
        };
        this.skipBits = function(count) {
          var skipBytes;
          if (workingBitsAvailable > count) {
            workingWord <<= count;
            workingBitsAvailable -= count;
          } else {
            count -= workingBitsAvailable;
            skipBytes = Math.floor(count / 8);
            count -= skipBytes * 8;
            workingBytesAvailable -= skipBytes;
            this.loadWord();
            workingWord <<= count;
            workingBitsAvailable -= count;
          }
        };
        this.readBits = function(size) {
          var bits = Math.min(workingBitsAvailable, size), valu = workingWord >>> 32 - bits;
          workingBitsAvailable -= bits;
          if (workingBitsAvailable > 0) {
            workingWord <<= bits;
          } else if (workingBytesAvailable > 0) {
            this.loadWord();
          }
          bits = size - bits;
          if (bits > 0) {
            return valu << bits | this.readBits(bits);
          }
          return valu;
        };
        this.skipLeadingZeros = function() {
          var leadingZeroCount;
          for (leadingZeroCount = 0; leadingZeroCount < workingBitsAvailable; ++leadingZeroCount) {
            if ((workingWord & 2147483648 >>> leadingZeroCount) !== 0) {
              workingWord <<= leadingZeroCount;
              workingBitsAvailable -= leadingZeroCount;
              return leadingZeroCount;
            }
          }
          this.loadWord();
          return leadingZeroCount + this.skipLeadingZeros();
        };
        this.skipUnsignedExpGolomb = function() {
          this.skipBits(1 + this.skipLeadingZeros());
        };
        this.skipExpGolomb = function() {
          this.skipBits(1 + this.skipLeadingZeros());
        };
        this.readUnsignedExpGolomb = function() {
          var clz = this.skipLeadingZeros();
          return this.readBits(clz + 1) - 1;
        };
        this.readExpGolomb = function() {
          var valu = this.readUnsignedExpGolomb();
          if (1 & valu) {
            return 1 + valu >>> 1;
          }
          return -1 * (valu >>> 1);
        };
        this.readBoolean = function() {
          return this.readBits(1) === 1;
        };
        this.readUnsignedByte = function() {
          return this.readBits(8);
        };
        this.loadWord();
      }, "ExpGolomb");
      var expGolomb = ExpGolomb;
      var _H264Stream, _NalByteStream;
      var PROFILES_WITH_OPTIONAL_SPS_DATA;
      _NalByteStream = /* @__PURE__ */ __name(function NalByteStream() {
        var syncPoint = 0, i, buffer;
        _NalByteStream.prototype.init.call(this);
        this.push = function(data) {
          var swapBuffer;
          if (!buffer) {
            buffer = data.data;
          } else {
            swapBuffer = new Uint8Array(buffer.byteLength + data.data.byteLength);
            swapBuffer.set(buffer);
            swapBuffer.set(data.data, buffer.byteLength);
            buffer = swapBuffer;
          }
          var len = buffer.byteLength;
          for (; syncPoint < len - 3; syncPoint++) {
            if (buffer[syncPoint + 2] === 1) {
              i = syncPoint + 5;
              break;
            }
          }
          while (i < len) {
            switch (buffer[i]) {
              case 0:
                if (buffer[i - 1] !== 0) {
                  i += 2;
                  break;
                } else if (buffer[i - 2] !== 0) {
                  i++;
                  break;
                }
                if (syncPoint + 3 !== i - 2) {
                  this.trigger("data", buffer.subarray(syncPoint + 3, i - 2));
                }
                do {
                  i++;
                } while (buffer[i] !== 1 && i < len);
                syncPoint = i - 2;
                i += 3;
                break;
              case 1:
                if (buffer[i - 1] !== 0 || buffer[i - 2] !== 0) {
                  i += 3;
                  break;
                }
                this.trigger("data", buffer.subarray(syncPoint + 3, i - 2));
                syncPoint = i - 2;
                i += 3;
                break;
              default:
                i += 3;
                break;
            }
          }
          buffer = buffer.subarray(syncPoint);
          i -= syncPoint;
          syncPoint = 0;
        };
        this.reset = function() {
          buffer = null;
          syncPoint = 0;
          this.trigger("reset");
        };
        this.flush = function() {
          if (buffer && buffer.byteLength > 3) {
            this.trigger("data", buffer.subarray(syncPoint + 3));
          }
          buffer = null;
          syncPoint = 0;
          this.trigger("done");
        };
        this.endTimeline = function() {
          this.flush();
          this.trigger("endedtimeline");
        };
      }, "NalByteStream");
      _NalByteStream.prototype = new stream();
      PROFILES_WITH_OPTIONAL_SPS_DATA = {
        100: true,
        110: true,
        122: true,
        244: true,
        44: true,
        83: true,
        86: true,
        118: true,
        128: true,
        // TODO: the three profiles below don't
        // appear to have sps data in the specificiation anymore?
        138: true,
        139: true,
        134: true
      };
      _H264Stream = /* @__PURE__ */ __name(function H264Stream2() {
        var nalByteStream = new _NalByteStream(), self2, trackId, currentPts, currentDts, discardEmulationPreventionBytes2, readSequenceParameterSet, skipScalingList;
        _H264Stream.prototype.init.call(this);
        self2 = this;
        this.push = function(packet) {
          if (packet.type !== "video") {
            return;
          }
          trackId = packet.trackId;
          currentPts = packet.pts;
          currentDts = packet.dts;
          nalByteStream.push(packet);
        };
        nalByteStream.on("data", function(data) {
          var event = {
            trackId,
            pts: currentPts,
            dts: currentDts,
            data,
            nalUnitTypeCode: data[0] & 31
          };
          switch (event.nalUnitTypeCode) {
            case 5:
              event.nalUnitType = "slice_layer_without_partitioning_rbsp_idr";
              break;
            case 6:
              event.nalUnitType = "sei_rbsp";
              event.escapedRBSP = discardEmulationPreventionBytes2(data.subarray(1));
              break;
            case 7:
              event.nalUnitType = "seq_parameter_set_rbsp";
              event.escapedRBSP = discardEmulationPreventionBytes2(data.subarray(1));
              event.config = readSequenceParameterSet(event.escapedRBSP);
              break;
            case 8:
              event.nalUnitType = "pic_parameter_set_rbsp";
              break;
            case 9:
              event.nalUnitType = "access_unit_delimiter_rbsp";
              break;
          }
          self2.trigger("data", event);
        });
        nalByteStream.on("done", function() {
          self2.trigger("done");
        });
        nalByteStream.on("partialdone", function() {
          self2.trigger("partialdone");
        });
        nalByteStream.on("reset", function() {
          self2.trigger("reset");
        });
        nalByteStream.on("endedtimeline", function() {
          self2.trigger("endedtimeline");
        });
        this.flush = function() {
          nalByteStream.flush();
        };
        this.partialFlush = function() {
          nalByteStream.partialFlush();
        };
        this.reset = function() {
          nalByteStream.reset();
        };
        this.endTimeline = function() {
          nalByteStream.endTimeline();
        };
        skipScalingList = /* @__PURE__ */ __name(function skipScalingList2(count, expGolombDecoder) {
          var lastScale = 8, nextScale = 8, j, deltaScale;
          for (j = 0; j < count; j++) {
            if (nextScale !== 0) {
              deltaScale = expGolombDecoder.readExpGolomb();
              nextScale = (lastScale + deltaScale + 256) % 256;
            }
            lastScale = nextScale === 0 ? lastScale : nextScale;
          }
        }, "skipScalingList");
        discardEmulationPreventionBytes2 = /* @__PURE__ */ __name(function discardEmulationPreventionBytes3(data) {
          var length = data.byteLength, emulationPreventionBytesPositions = [], i = 1, newLength, newData;
          while (i < length - 2) {
            if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 3) {
              emulationPreventionBytesPositions.push(i + 2);
              i += 2;
            } else {
              i++;
            }
          }
          if (emulationPreventionBytesPositions.length === 0) {
            return data;
          }
          newLength = length - emulationPreventionBytesPositions.length;
          newData = new Uint8Array(newLength);
          var sourceIndex = 0;
          for (i = 0; i < newLength; sourceIndex++, i++) {
            if (sourceIndex === emulationPreventionBytesPositions[0]) {
              sourceIndex++;
              emulationPreventionBytesPositions.shift();
            }
            newData[i] = data[sourceIndex];
          }
          return newData;
        }, "discardEmulationPreventionBytes");
        readSequenceParameterSet = /* @__PURE__ */ __name(function readSequenceParameterSet2(data) {
          var frameCropLeftOffset = 0, frameCropRightOffset = 0, frameCropTopOffset = 0, frameCropBottomOffset = 0, expGolombDecoder, profileIdc, levelIdc, profileCompatibility, chromaFormatIdc, picOrderCntType, numRefFramesInPicOrderCntCycle, picWidthInMbsMinus1, picHeightInMapUnitsMinus1, frameMbsOnlyFlag, scalingListCount, sarRatio = [1, 1], aspectRatioIdc, i;
          expGolombDecoder = new expGolomb(data);
          profileIdc = expGolombDecoder.readUnsignedByte();
          profileCompatibility = expGolombDecoder.readUnsignedByte();
          levelIdc = expGolombDecoder.readUnsignedByte();
          expGolombDecoder.skipUnsignedExpGolomb();
          if (PROFILES_WITH_OPTIONAL_SPS_DATA[profileIdc]) {
            chromaFormatIdc = expGolombDecoder.readUnsignedExpGolomb();
            if (chromaFormatIdc === 3) {
              expGolombDecoder.skipBits(1);
            }
            expGolombDecoder.skipUnsignedExpGolomb();
            expGolombDecoder.skipUnsignedExpGolomb();
            expGolombDecoder.skipBits(1);
            if (expGolombDecoder.readBoolean()) {
              scalingListCount = chromaFormatIdc !== 3 ? 8 : 12;
              for (i = 0; i < scalingListCount; i++) {
                if (expGolombDecoder.readBoolean()) {
                  if (i < 6) {
                    skipScalingList(16, expGolombDecoder);
                  } else {
                    skipScalingList(64, expGolombDecoder);
                  }
                }
              }
            }
          }
          expGolombDecoder.skipUnsignedExpGolomb();
          picOrderCntType = expGolombDecoder.readUnsignedExpGolomb();
          if (picOrderCntType === 0) {
            expGolombDecoder.readUnsignedExpGolomb();
          } else if (picOrderCntType === 1) {
            expGolombDecoder.skipBits(1);
            expGolombDecoder.skipExpGolomb();
            expGolombDecoder.skipExpGolomb();
            numRefFramesInPicOrderCntCycle = expGolombDecoder.readUnsignedExpGolomb();
            for (i = 0; i < numRefFramesInPicOrderCntCycle; i++) {
              expGolombDecoder.skipExpGolomb();
            }
          }
          expGolombDecoder.skipUnsignedExpGolomb();
          expGolombDecoder.skipBits(1);
          picWidthInMbsMinus1 = expGolombDecoder.readUnsignedExpGolomb();
          picHeightInMapUnitsMinus1 = expGolombDecoder.readUnsignedExpGolomb();
          frameMbsOnlyFlag = expGolombDecoder.readBits(1);
          if (frameMbsOnlyFlag === 0) {
            expGolombDecoder.skipBits(1);
          }
          expGolombDecoder.skipBits(1);
          if (expGolombDecoder.readBoolean()) {
            frameCropLeftOffset = expGolombDecoder.readUnsignedExpGolomb();
            frameCropRightOffset = expGolombDecoder.readUnsignedExpGolomb();
            frameCropTopOffset = expGolombDecoder.readUnsignedExpGolomb();
            frameCropBottomOffset = expGolombDecoder.readUnsignedExpGolomb();
          }
          if (expGolombDecoder.readBoolean()) {
            if (expGolombDecoder.readBoolean()) {
              aspectRatioIdc = expGolombDecoder.readUnsignedByte();
              switch (aspectRatioIdc) {
                case 1:
                  sarRatio = [1, 1];
                  break;
                case 2:
                  sarRatio = [12, 11];
                  break;
                case 3:
                  sarRatio = [10, 11];
                  break;
                case 4:
                  sarRatio = [16, 11];
                  break;
                case 5:
                  sarRatio = [40, 33];
                  break;
                case 6:
                  sarRatio = [24, 11];
                  break;
                case 7:
                  sarRatio = [20, 11];
                  break;
                case 8:
                  sarRatio = [32, 11];
                  break;
                case 9:
                  sarRatio = [80, 33];
                  break;
                case 10:
                  sarRatio = [18, 11];
                  break;
                case 11:
                  sarRatio = [15, 11];
                  break;
                case 12:
                  sarRatio = [64, 33];
                  break;
                case 13:
                  sarRatio = [160, 99];
                  break;
                case 14:
                  sarRatio = [4, 3];
                  break;
                case 15:
                  sarRatio = [3, 2];
                  break;
                case 16:
                  sarRatio = [2, 1];
                  break;
                case 255: {
                  sarRatio = [expGolombDecoder.readUnsignedByte() << 8 | expGolombDecoder.readUnsignedByte(), expGolombDecoder.readUnsignedByte() << 8 | expGolombDecoder.readUnsignedByte()];
                  break;
                }
              }
              if (sarRatio) {
                sarRatio[0] / sarRatio[1];
              }
            }
          }
          return {
            profileIdc,
            levelIdc,
            profileCompatibility,
            width: (picWidthInMbsMinus1 + 1) * 16 - frameCropLeftOffset * 2 - frameCropRightOffset * 2,
            height: (2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16 - frameCropTopOffset * 2 - frameCropBottomOffset * 2,
            // sar is sample aspect ratio
            sarRatio
          };
        }, "readSequenceParameterSet");
      }, "H264Stream");
      _H264Stream.prototype = new stream();
      var h264 = {
        H264Stream: _H264Stream,
        NalByteStream: _NalByteStream
      };
      var codecs = {
        Adts: adts,
        h264
      };
      var MAX_UINT32$1 = Math.pow(2, 32);
      var getUint64$5 = /* @__PURE__ */ __name(function getUint642(uint8) {
        var dv = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
        var value;
        if (dv.getBigUint64) {
          value = dv.getBigUint64(0);
          if (value < Number.MAX_SAFE_INTEGER) {
            return Number(value);
          }
          return value;
        }
        return dv.getUint32(0) * MAX_UINT32$1 + dv.getUint32(4);
      }, "getUint64");
      var numbers = {
        getUint64: getUint64$5,
        MAX_UINT32: MAX_UINT32$1
      };
      var MAX_UINT32 = numbers.MAX_UINT32;
      var box, dinf, esds, ftyp, mdat, mfhd, minf, moof, moov, mvex, mvhd, trak, tkhd, mdia, mdhd, hdlr, sdtp, stbl, stsd, traf, trex, trun$1, types, MAJOR_BRAND, MINOR_VERSION, AVC1_BRAND, VIDEO_HDLR, AUDIO_HDLR, HDLR_TYPES, VMHD, SMHD, DREF, STCO, STSC, STSZ, STTS;
      (function() {
        var i;
        types = {
          avc1: [],
          // codingname
          avcC: [],
          btrt: [],
          dinf: [],
          dref: [],
          esds: [],
          ftyp: [],
          hdlr: [],
          mdat: [],
          mdhd: [],
          mdia: [],
          mfhd: [],
          minf: [],
          moof: [],
          moov: [],
          mp4a: [],
          // codingname
          mvex: [],
          mvhd: [],
          pasp: [],
          sdtp: [],
          smhd: [],
          stbl: [],
          stco: [],
          stsc: [],
          stsd: [],
          stsz: [],
          stts: [],
          styp: [],
          tfdt: [],
          tfhd: [],
          traf: [],
          trak: [],
          trun: [],
          trex: [],
          tkhd: [],
          vmhd: []
        };
        if (typeof Uint8Array === "undefined") {
          return;
        }
        for (i in types) {
          if (types.hasOwnProperty(i)) {
            types[i] = [i.charCodeAt(0), i.charCodeAt(1), i.charCodeAt(2), i.charCodeAt(3)];
          }
        }
        MAJOR_BRAND = new Uint8Array(["i".charCodeAt(0), "s".charCodeAt(0), "o".charCodeAt(0), "m".charCodeAt(0)]);
        AVC1_BRAND = new Uint8Array(["a".charCodeAt(0), "v".charCodeAt(0), "c".charCodeAt(0), "1".charCodeAt(0)]);
        MINOR_VERSION = new Uint8Array([0, 0, 0, 1]);
        VIDEO_HDLR = new Uint8Array([
          0,
          // version 0
          0,
          0,
          0,
          // flags
          0,
          0,
          0,
          0,
          // pre_defined
          118,
          105,
          100,
          101,
          // handler_type: 'vide'
          0,
          0,
          0,
          0,
          // reserved
          0,
          0,
          0,
          0,
          // reserved
          0,
          0,
          0,
          0,
          // reserved
          86,
          105,
          100,
          101,
          111,
          72,
          97,
          110,
          100,
          108,
          101,
          114,
          0
          // name: 'VideoHandler'
        ]);
        AUDIO_HDLR = new Uint8Array([
          0,
          // version 0
          0,
          0,
          0,
          // flags
          0,
          0,
          0,
          0,
          // pre_defined
          115,
          111,
          117,
          110,
          // handler_type: 'soun'
          0,
          0,
          0,
          0,
          // reserved
          0,
          0,
          0,
          0,
          // reserved
          0,
          0,
          0,
          0,
          // reserved
          83,
          111,
          117,
          110,
          100,
          72,
          97,
          110,
          100,
          108,
          101,
          114,
          0
          // name: 'SoundHandler'
        ]);
        HDLR_TYPES = {
          video: VIDEO_HDLR,
          audio: AUDIO_HDLR
        };
        DREF = new Uint8Array([
          0,
          // version 0
          0,
          0,
          0,
          // flags
          0,
          0,
          0,
          1,
          // entry_count
          0,
          0,
          0,
          12,
          // entry_size
          117,
          114,
          108,
          32,
          // 'url' type
          0,
          // version 0
          0,
          0,
          1
          // entry_flags
        ]);
        SMHD = new Uint8Array([
          0,
          // version
          0,
          0,
          0,
          // flags
          0,
          0,
          // balance, 0 means centered
          0,
          0
          // reserved
        ]);
        STCO = new Uint8Array([
          0,
          // version
          0,
          0,
          0,
          // flags
          0,
          0,
          0,
          0
          // entry_count
        ]);
        STSC = STCO;
        STSZ = new Uint8Array([
          0,
          // version
          0,
          0,
          0,
          // flags
          0,
          0,
          0,
          0,
          // sample_size
          0,
          0,
          0,
          0
          // sample_count
        ]);
        STTS = STCO;
        VMHD = new Uint8Array([
          0,
          // version
          0,
          0,
          1,
          // flags
          0,
          0,
          // graphicsmode
          0,
          0,
          0,
          0,
          0,
          0
          // opcolor
        ]);
      })();
      box = /* @__PURE__ */ __name(function box2(type2) {
        var payload = [], size = 0, i, result, view;
        for (i = 1; i < arguments.length; i++) {
          payload.push(arguments[i]);
        }
        i = payload.length;
        while (i--) {
          size += payload[i].byteLength;
        }
        result = new Uint8Array(size + 8);
        view = new DataView(result.buffer, result.byteOffset, result.byteLength);
        view.setUint32(0, result.byteLength);
        result.set(type2, 4);
        for (i = 0, size = 8; i < payload.length; i++) {
          result.set(payload[i], size);
          size += payload[i].byteLength;
        }
        return result;
      }, "box");
      dinf = /* @__PURE__ */ __name(function dinf2() {
        return box(types.dinf, box(types.dref, DREF));
      }, "dinf");
      esds = /* @__PURE__ */ __name(function esds2(track) {
        return box(types.esds, new Uint8Array([
          0,
          // version
          0,
          0,
          0,
          // flags
          // ES_Descriptor
          3,
          // tag, ES_DescrTag
          25,
          // length
          0,
          0,
          // ES_ID
          0,
          // streamDependenceFlag, URL_flag, reserved, streamPriority
          // DecoderConfigDescriptor
          4,
          // tag, DecoderConfigDescrTag
          17,
          // length
          64,
          // object type
          21,
          // streamType
          0,
          6,
          0,
          // bufferSizeDB
          0,
          0,
          218,
          192,
          // maxBitrate
          0,
          0,
          218,
          192,
          // avgBitrate
          // DecoderSpecificInfo
          5,
          // tag, DecoderSpecificInfoTag
          2,
          // length
          // ISO/IEC 14496-3, AudioSpecificConfig
          // for samplingFrequencyIndex see ISO/IEC 13818-7:2006, 8.1.3.2.2, Table 35
          track.audioobjecttype << 3 | track.samplingfrequencyindex >>> 1,
          track.samplingfrequencyindex << 7 | track.channelcount << 3,
          6,
          1,
          2
          // GASpecificConfig
        ]));
      }, "esds");
      ftyp = /* @__PURE__ */ __name(function ftyp2() {
        return box(types.ftyp, MAJOR_BRAND, MINOR_VERSION, MAJOR_BRAND, AVC1_BRAND);
      }, "ftyp");
      hdlr = /* @__PURE__ */ __name(function hdlr2(type2) {
        return box(types.hdlr, HDLR_TYPES[type2]);
      }, "hdlr");
      mdat = /* @__PURE__ */ __name(function mdat2(data) {
        return box(types.mdat, data);
      }, "mdat");
      mdhd = /* @__PURE__ */ __name(function mdhd2(track) {
        var result = new Uint8Array([
          0,
          // version 0
          0,
          0,
          0,
          // flags
          0,
          0,
          0,
          2,
          // creation_time
          0,
          0,
          0,
          3,
          // modification_time
          0,
          1,
          95,
          144,
          // timescale, 90,000 "ticks" per second
          track.duration >>> 24 & 255,
          track.duration >>> 16 & 255,
          track.duration >>> 8 & 255,
          track.duration & 255,
          // duration
          85,
          196,
          // 'und' language (undetermined)
          0,
          0
        ]);
        if (track.samplerate) {
          result[12] = track.samplerate >>> 24 & 255;
          result[13] = track.samplerate >>> 16 & 255;
          result[14] = track.samplerate >>> 8 & 255;
          result[15] = track.samplerate & 255;
        }
        return box(types.mdhd, result);
      }, "mdhd");
      mdia = /* @__PURE__ */ __name(function mdia2(track) {
        return box(types.mdia, mdhd(track), hdlr(track.type), minf(track));
      }, "mdia");
      mfhd = /* @__PURE__ */ __name(function mfhd2(sequenceNumber) {
        return box(types.mfhd, new Uint8Array([
          0,
          0,
          0,
          0,
          // flags
          (sequenceNumber & 4278190080) >> 24,
          (sequenceNumber & 16711680) >> 16,
          (sequenceNumber & 65280) >> 8,
          sequenceNumber & 255
          // sequence_number
        ]));
      }, "mfhd");
      minf = /* @__PURE__ */ __name(function minf2(track) {
        return box(types.minf, track.type === "video" ? box(types.vmhd, VMHD) : box(types.smhd, SMHD), dinf(), stbl(track));
      }, "minf");
      moof = /* @__PURE__ */ __name(function moof2(sequenceNumber, tracks) {
        var trackFragments = [], i = tracks.length;
        while (i--) {
          trackFragments[i] = traf(tracks[i]);
        }
        return box.apply(null, [types.moof, mfhd(sequenceNumber)].concat(trackFragments));
      }, "moof");
      moov = /* @__PURE__ */ __name(function moov2(tracks) {
        var i = tracks.length, boxes = [];
        while (i--) {
          boxes[i] = trak(tracks[i]);
        }
        return box.apply(null, [types.moov, mvhd(4294967295)].concat(boxes).concat(mvex(tracks)));
      }, "moov");
      mvex = /* @__PURE__ */ __name(function mvex2(tracks) {
        var i = tracks.length, boxes = [];
        while (i--) {
          boxes[i] = trex(tracks[i]);
        }
        return box.apply(null, [types.mvex].concat(boxes));
      }, "mvex");
      mvhd = /* @__PURE__ */ __name(function mvhd2(duration) {
        var bytes = new Uint8Array([
          0,
          // version 0
          0,
          0,
          0,
          // flags
          0,
          0,
          0,
          1,
          // creation_time
          0,
          0,
          0,
          2,
          // modification_time
          0,
          1,
          95,
          144,
          // timescale, 90,000 "ticks" per second
          (duration & 4278190080) >> 24,
          (duration & 16711680) >> 16,
          (duration & 65280) >> 8,
          duration & 255,
          // duration
          0,
          1,
          0,
          0,
          // 1.0 rate
          1,
          0,
          // 1.0 volume
          0,
          0,
          // reserved
          0,
          0,
          0,
          0,
          // reserved
          0,
          0,
          0,
          0,
          // reserved
          0,
          1,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          64,
          0,
          0,
          0,
          // transformation: unity matrix
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          // pre_defined
          255,
          255,
          255,
          255
          // next_track_ID
        ]);
        return box(types.mvhd, bytes);
      }, "mvhd");
      sdtp = /* @__PURE__ */ __name(function sdtp2(track) {
        var samples2 = track.samples || [], bytes = new Uint8Array(4 + samples2.length), flags, i;
        for (i = 0; i < samples2.length; i++) {
          flags = samples2[i].flags;
          bytes[i + 4] = flags.dependsOn << 4 | flags.isDependedOn << 2 | flags.hasRedundancy;
        }
        return box(types.sdtp, bytes);
      }, "sdtp");
      stbl = /* @__PURE__ */ __name(function stbl2(track) {
        return box(types.stbl, stsd(track), box(types.stts, STTS), box(types.stsc, STSC), box(types.stsz, STSZ), box(types.stco, STCO));
      }, "stbl");
      (function() {
        var videoSample, audioSample;
        stsd = /* @__PURE__ */ __name(function stsd2(track) {
          return box(types.stsd, new Uint8Array([
            0,
            // version 0
            0,
            0,
            0,
            // flags
            0,
            0,
            0,
            1
          ]), track.type === "video" ? videoSample(track) : audioSample(track));
        }, "stsd");
        videoSample = /* @__PURE__ */ __name(function videoSample2(track) {
          var sps = track.sps || [], pps = track.pps || [], sequenceParameterSets = [], pictureParameterSets = [], i, avc1Box;
          for (i = 0; i < sps.length; i++) {
            sequenceParameterSets.push((sps[i].byteLength & 65280) >>> 8);
            sequenceParameterSets.push(sps[i].byteLength & 255);
            sequenceParameterSets = sequenceParameterSets.concat(Array.prototype.slice.call(sps[i]));
          }
          for (i = 0; i < pps.length; i++) {
            pictureParameterSets.push((pps[i].byteLength & 65280) >>> 8);
            pictureParameterSets.push(pps[i].byteLength & 255);
            pictureParameterSets = pictureParameterSets.concat(Array.prototype.slice.call(pps[i]));
          }
          avc1Box = [types.avc1, new Uint8Array([
            0,
            0,
            0,
            0,
            0,
            0,
            // reserved
            0,
            1,
            // data_reference_index
            0,
            0,
            // pre_defined
            0,
            0,
            // reserved
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            // pre_defined
            (track.width & 65280) >> 8,
            track.width & 255,
            // width
            (track.height & 65280) >> 8,
            track.height & 255,
            // height
            0,
            72,
            0,
            0,
            // horizresolution
            0,
            72,
            0,
            0,
            // vertresolution
            0,
            0,
            0,
            0,
            // reserved
            0,
            1,
            // frame_count
            19,
            118,
            105,
            100,
            101,
            111,
            106,
            115,
            45,
            99,
            111,
            110,
            116,
            114,
            105,
            98,
            45,
            104,
            108,
            115,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            // compressorname
            0,
            24,
            // depth = 24
            17,
            17
            // pre_defined = -1
          ]), box(types.avcC, new Uint8Array([
            1,
            // configurationVersion
            track.profileIdc,
            // AVCProfileIndication
            track.profileCompatibility,
            // profile_compatibility
            track.levelIdc,
            // AVCLevelIndication
            255
            // lengthSizeMinusOne, hard-coded to 4 bytes
          ].concat(
            [sps.length],
            // numOfSequenceParameterSets
            sequenceParameterSets,
            // "SPS"
            [pps.length],
            // numOfPictureParameterSets
            pictureParameterSets
            // "PPS"
          ))), box(types.btrt, new Uint8Array([
            0,
            28,
            156,
            128,
            // bufferSizeDB
            0,
            45,
            198,
            192,
            // maxBitrate
            0,
            45,
            198,
            192
            // avgBitrate
          ]))];
          if (track.sarRatio) {
            var hSpacing = track.sarRatio[0], vSpacing = track.sarRatio[1];
            avc1Box.push(box(types.pasp, new Uint8Array([(hSpacing & 4278190080) >> 24, (hSpacing & 16711680) >> 16, (hSpacing & 65280) >> 8, hSpacing & 255, (vSpacing & 4278190080) >> 24, (vSpacing & 16711680) >> 16, (vSpacing & 65280) >> 8, vSpacing & 255])));
          }
          return box.apply(null, avc1Box);
        }, "videoSample");
        audioSample = /* @__PURE__ */ __name(function audioSample2(track) {
          return box(types.mp4a, new Uint8Array([
            // SampleEntry, ISO/IEC 14496-12
            0,
            0,
            0,
            0,
            0,
            0,
            // reserved
            0,
            1,
            // data_reference_index
            // AudioSampleEntry, ISO/IEC 14496-12
            0,
            0,
            0,
            0,
            // reserved
            0,
            0,
            0,
            0,
            // reserved
            (track.channelcount & 65280) >> 8,
            track.channelcount & 255,
            // channelcount
            (track.samplesize & 65280) >> 8,
            track.samplesize & 255,
            // samplesize
            0,
            0,
            // pre_defined
            0,
            0,
            // reserved
            (track.samplerate & 65280) >> 8,
            track.samplerate & 255,
            0,
            0
            // samplerate, 16.16
            // MP4AudioSampleEntry, ISO/IEC 14496-14
          ]), esds(track));
        }, "audioSample");
      })();
      tkhd = /* @__PURE__ */ __name(function tkhd2(track) {
        var result = new Uint8Array([
          0,
          // version 0
          0,
          0,
          7,
          // flags
          0,
          0,
          0,
          0,
          // creation_time
          0,
          0,
          0,
          0,
          // modification_time
          (track.id & 4278190080) >> 24,
          (track.id & 16711680) >> 16,
          (track.id & 65280) >> 8,
          track.id & 255,
          // track_ID
          0,
          0,
          0,
          0,
          // reserved
          (track.duration & 4278190080) >> 24,
          (track.duration & 16711680) >> 16,
          (track.duration & 65280) >> 8,
          track.duration & 255,
          // duration
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          // reserved
          0,
          0,
          // layer
          0,
          0,
          // alternate_group
          1,
          0,
          // non-audio track volume
          0,
          0,
          // reserved
          0,
          1,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          64,
          0,
          0,
          0,
          // transformation: unity matrix
          (track.width & 65280) >> 8,
          track.width & 255,
          0,
          0,
          // width
          (track.height & 65280) >> 8,
          track.height & 255,
          0,
          0
          // height
        ]);
        return box(types.tkhd, result);
      }, "tkhd");
      traf = /* @__PURE__ */ __name(function traf2(track) {
        var trackFragmentHeader, trackFragmentDecodeTime, trackFragmentRun, sampleDependencyTable, dataOffset, upperWordBaseMediaDecodeTime, lowerWordBaseMediaDecodeTime;
        trackFragmentHeader = box(types.tfhd, new Uint8Array([
          0,
          // version 0
          0,
          0,
          58,
          // flags
          (track.id & 4278190080) >> 24,
          (track.id & 16711680) >> 16,
          (track.id & 65280) >> 8,
          track.id & 255,
          // track_ID
          0,
          0,
          0,
          1,
          // sample_description_index
          0,
          0,
          0,
          0,
          // default_sample_duration
          0,
          0,
          0,
          0,
          // default_sample_size
          0,
          0,
          0,
          0
          // default_sample_flags
        ]));
        upperWordBaseMediaDecodeTime = Math.floor(track.baseMediaDecodeTime / MAX_UINT32);
        lowerWordBaseMediaDecodeTime = Math.floor(track.baseMediaDecodeTime % MAX_UINT32);
        trackFragmentDecodeTime = box(types.tfdt, new Uint8Array([
          1,
          // version 1
          0,
          0,
          0,
          // flags
          // baseMediaDecodeTime
          upperWordBaseMediaDecodeTime >>> 24 & 255,
          upperWordBaseMediaDecodeTime >>> 16 & 255,
          upperWordBaseMediaDecodeTime >>> 8 & 255,
          upperWordBaseMediaDecodeTime & 255,
          lowerWordBaseMediaDecodeTime >>> 24 & 255,
          lowerWordBaseMediaDecodeTime >>> 16 & 255,
          lowerWordBaseMediaDecodeTime >>> 8 & 255,
          lowerWordBaseMediaDecodeTime & 255
        ]));
        dataOffset = 32 + // tfhd
        20 + // tfdt
        8 + // traf header
        16 + // mfhd
        8 + // moof header
        8;
        if (track.type === "audio") {
          trackFragmentRun = trun$1(track, dataOffset);
          return box(types.traf, trackFragmentHeader, trackFragmentDecodeTime, trackFragmentRun);
        }
        sampleDependencyTable = sdtp(track);
        trackFragmentRun = trun$1(track, sampleDependencyTable.length + dataOffset);
        return box(types.traf, trackFragmentHeader, trackFragmentDecodeTime, trackFragmentRun, sampleDependencyTable);
      }, "traf");
      trak = /* @__PURE__ */ __name(function trak2(track) {
        track.duration = track.duration || 4294967295;
        return box(types.trak, tkhd(track), mdia(track));
      }, "trak");
      trex = /* @__PURE__ */ __name(function trex2(track) {
        var result = new Uint8Array([
          0,
          // version 0
          0,
          0,
          0,
          // flags
          (track.id & 4278190080) >> 24,
          (track.id & 16711680) >> 16,
          (track.id & 65280) >> 8,
          track.id & 255,
          // track_ID
          0,
          0,
          0,
          1,
          // default_sample_description_index
          0,
          0,
          0,
          0,
          // default_sample_duration
          0,
          0,
          0,
          0,
          // default_sample_size
          0,
          1,
          0,
          1
          // default_sample_flags
        ]);
        if (track.type !== "video") {
          result[result.length - 1] = 0;
        }
        return box(types.trex, result);
      }, "trex");
      (function() {
        var audioTrun, videoTrun, trunHeader;
        trunHeader = /* @__PURE__ */ __name(function trunHeader2(samples2, offset) {
          var durationPresent = 0, sizePresent = 0, flagsPresent = 0, compositionTimeOffset = 0;
          if (samples2.length) {
            if (samples2[0].duration !== void 0) {
              durationPresent = 1;
            }
            if (samples2[0].size !== void 0) {
              sizePresent = 2;
            }
            if (samples2[0].flags !== void 0) {
              flagsPresent = 4;
            }
            if (samples2[0].compositionTimeOffset !== void 0) {
              compositionTimeOffset = 8;
            }
          }
          return [
            0,
            // version 0
            0,
            durationPresent | sizePresent | flagsPresent | compositionTimeOffset,
            1,
            // flags
            (samples2.length & 4278190080) >>> 24,
            (samples2.length & 16711680) >>> 16,
            (samples2.length & 65280) >>> 8,
            samples2.length & 255,
            // sample_count
            (offset & 4278190080) >>> 24,
            (offset & 16711680) >>> 16,
            (offset & 65280) >>> 8,
            offset & 255
            // data_offset
          ];
        }, "trunHeader");
        videoTrun = /* @__PURE__ */ __name(function videoTrun2(track, offset) {
          var bytesOffest, bytes, header, samples2, sample, i;
          samples2 = track.samples || [];
          offset += 8 + 12 + 16 * samples2.length;
          header = trunHeader(samples2, offset);
          bytes = new Uint8Array(header.length + samples2.length * 16);
          bytes.set(header);
          bytesOffest = header.length;
          for (i = 0; i < samples2.length; i++) {
            sample = samples2[i];
            bytes[bytesOffest++] = (sample.duration & 4278190080) >>> 24;
            bytes[bytesOffest++] = (sample.duration & 16711680) >>> 16;
            bytes[bytesOffest++] = (sample.duration & 65280) >>> 8;
            bytes[bytesOffest++] = sample.duration & 255;
            bytes[bytesOffest++] = (sample.size & 4278190080) >>> 24;
            bytes[bytesOffest++] = (sample.size & 16711680) >>> 16;
            bytes[bytesOffest++] = (sample.size & 65280) >>> 8;
            bytes[bytesOffest++] = sample.size & 255;
            bytes[bytesOffest++] = sample.flags.isLeading << 2 | sample.flags.dependsOn;
            bytes[bytesOffest++] = sample.flags.isDependedOn << 6 | sample.flags.hasRedundancy << 4 | sample.flags.paddingValue << 1 | sample.flags.isNonSyncSample;
            bytes[bytesOffest++] = sample.flags.degradationPriority & 240 << 8;
            bytes[bytesOffest++] = sample.flags.degradationPriority & 15;
            bytes[bytesOffest++] = (sample.compositionTimeOffset & 4278190080) >>> 24;
            bytes[bytesOffest++] = (sample.compositionTimeOffset & 16711680) >>> 16;
            bytes[bytesOffest++] = (sample.compositionTimeOffset & 65280) >>> 8;
            bytes[bytesOffest++] = sample.compositionTimeOffset & 255;
          }
          return box(types.trun, bytes);
        }, "videoTrun");
        audioTrun = /* @__PURE__ */ __name(function audioTrun2(track, offset) {
          var bytes, bytesOffest, header, samples2, sample, i;
          samples2 = track.samples || [];
          offset += 8 + 12 + 8 * samples2.length;
          header = trunHeader(samples2, offset);
          bytes = new Uint8Array(header.length + samples2.length * 8);
          bytes.set(header);
          bytesOffest = header.length;
          for (i = 0; i < samples2.length; i++) {
            sample = samples2[i];
            bytes[bytesOffest++] = (sample.duration & 4278190080) >>> 24;
            bytes[bytesOffest++] = (sample.duration & 16711680) >>> 16;
            bytes[bytesOffest++] = (sample.duration & 65280) >>> 8;
            bytes[bytesOffest++] = sample.duration & 255;
            bytes[bytesOffest++] = (sample.size & 4278190080) >>> 24;
            bytes[bytesOffest++] = (sample.size & 16711680) >>> 16;
            bytes[bytesOffest++] = (sample.size & 65280) >>> 8;
            bytes[bytesOffest++] = sample.size & 255;
          }
          return box(types.trun, bytes);
        }, "audioTrun");
        trun$1 = /* @__PURE__ */ __name(function trun2(track, offset) {
          if (track.type === "audio") {
            return audioTrun(track, offset);
          }
          return videoTrun(track, offset);
        }, "trun");
      })();
      var mp4Generator = {
        ftyp,
        mdat,
        moof,
        moov,
        initSegment: /* @__PURE__ */ __name(function initSegment(tracks) {
          var fileType = ftyp(), movie = moov(tracks), result;
          result = new Uint8Array(fileType.byteLength + movie.byteLength);
          result.set(fileType);
          result.set(movie, fileType.byteLength);
          return result;
        }, "initSegment")
      };
      var toUnsigned$3 = /* @__PURE__ */ __name(function toUnsigned2(value) {
        return value >>> 0;
      }, "toUnsigned");
      var toHexString$1 = /* @__PURE__ */ __name(function toHexString2(value) {
        return ("00" + value.toString(16)).slice(-2);
      }, "toHexString");
      var bin = {
        toUnsigned: toUnsigned$3,
        toHexString: toHexString$1
      };
      var parseType$2 = /* @__PURE__ */ __name(function parseType2(buffer) {
        var result = "";
        result += String.fromCharCode(buffer[0]);
        result += String.fromCharCode(buffer[1]);
        result += String.fromCharCode(buffer[2]);
        result += String.fromCharCode(buffer[3]);
        return result;
      }, "parseType");
      var parseType_1 = parseType$2;
      var toUnsigned$2 = bin.toUnsigned;
      var findBox$1 = /* @__PURE__ */ __name(function findBox2(data, path) {
        var results = [], i, size, type2, end, subresults;
        if (!path.length) {
          return null;
        }
        for (i = 0; i < data.byteLength; ) {
          size = toUnsigned$2(data[i] << 24 | data[i + 1] << 16 | data[i + 2] << 8 | data[i + 3]);
          type2 = parseType_1(data.subarray(i + 4, i + 8));
          end = size > 1 ? i + size : data.byteLength;
          if (type2 === path[0]) {
            if (path.length === 1) {
              results.push(data.subarray(i + 8, end));
            } else {
              subresults = findBox2(data.subarray(i + 8, end), path.slice(1));
              if (subresults.length) {
                results = results.concat(subresults);
              }
            }
          }
          i = end;
        }
        return results;
      }, "findBox");
      var findBox_1 = findBox$1;
      var uint8ToCString$1 = /* @__PURE__ */ __name(function uint8ToCString2(data) {
        var index = 0;
        var curChar = String.fromCharCode(data[index]);
        var retString = "";
        while (curChar !== "\0") {
          retString += curChar;
          index++;
          curChar = String.fromCharCode(data[index]);
        }
        retString += curChar;
        return retString;
      }, "uint8ToCString");
      var string = {
        uint8ToCString: uint8ToCString$1
      };
      var uint8ToCString = string.uint8ToCString;
      var getUint64$4 = numbers.getUint64;
      var parseEmsgBox = /* @__PURE__ */ __name(function parseEmsgBox2(boxData) {
        var offset = 4;
        var version = boxData[0];
        var scheme_id_uri, value, timescale2, presentation_time, presentation_time_delta, event_duration, id, message_data;
        if (version === 0) {
          scheme_id_uri = uint8ToCString(boxData.subarray(offset));
          offset += scheme_id_uri.length;
          value = uint8ToCString(boxData.subarray(offset));
          offset += value.length;
          var dv = new DataView(boxData.buffer);
          timescale2 = dv.getUint32(offset);
          offset += 4;
          presentation_time_delta = dv.getUint32(offset);
          offset += 4;
          event_duration = dv.getUint32(offset);
          offset += 4;
          id = dv.getUint32(offset);
          offset += 4;
        } else if (version === 1) {
          var dv = new DataView(boxData.buffer);
          timescale2 = dv.getUint32(offset);
          offset += 4;
          presentation_time = getUint64$4(boxData.subarray(offset));
          offset += 8;
          event_duration = dv.getUint32(offset);
          offset += 4;
          id = dv.getUint32(offset);
          offset += 4;
          scheme_id_uri = uint8ToCString(boxData.subarray(offset));
          offset += scheme_id_uri.length;
          value = uint8ToCString(boxData.subarray(offset));
          offset += value.length;
        }
        message_data = new Uint8Array(boxData.subarray(offset, boxData.byteLength));
        var emsgBox = {
          scheme_id_uri,
          value,
          // if timescale is undefined or 0 set to 1 
          timescale: timescale2 ? timescale2 : 1,
          presentation_time,
          presentation_time_delta,
          event_duration,
          id,
          message_data
        };
        return isValidEmsgBox(version, emsgBox) ? emsgBox : void 0;
      }, "parseEmsgBox");
      var scaleTime = /* @__PURE__ */ __name(function scaleTime2(presentationTime, timescale2, timeDelta, offset) {
        return presentationTime || presentationTime === 0 ? presentationTime / timescale2 : offset + timeDelta / timescale2;
      }, "scaleTime");
      var isValidEmsgBox = /* @__PURE__ */ __name(function isValidEmsgBox2(version, emsg2) {
        var hasScheme = emsg2.scheme_id_uri !== "\0";
        var isValidV0Box = version === 0 && isDefined(emsg2.presentation_time_delta) && hasScheme;
        var isValidV1Box = version === 1 && isDefined(emsg2.presentation_time) && hasScheme;
        return !(version > 1) && isValidV0Box || isValidV1Box;
      }, "isValidEmsgBox");
      var isDefined = /* @__PURE__ */ __name(function isDefined2(data) {
        return data !== void 0 || data !== null;
      }, "isDefined");
      var emsg = {
        parseEmsgBox,
        scaleTime
      };
      var tfhd = /* @__PURE__ */ __name(function tfhd2(data) {
        var view = new DataView(data.buffer, data.byteOffset, data.byteLength), result = {
          version: data[0],
          flags: new Uint8Array(data.subarray(1, 4)),
          trackId: view.getUint32(4)
        }, baseDataOffsetPresent = result.flags[2] & 1, sampleDescriptionIndexPresent = result.flags[2] & 2, defaultSampleDurationPresent = result.flags[2] & 8, defaultSampleSizePresent = result.flags[2] & 16, defaultSampleFlagsPresent = result.flags[2] & 32, durationIsEmpty = result.flags[0] & 65536, defaultBaseIsMoof = result.flags[0] & 131072, i;
        i = 8;
        if (baseDataOffsetPresent) {
          i += 4;
          result.baseDataOffset = view.getUint32(12);
          i += 4;
        }
        if (sampleDescriptionIndexPresent) {
          result.sampleDescriptionIndex = view.getUint32(i);
          i += 4;
        }
        if (defaultSampleDurationPresent) {
          result.defaultSampleDuration = view.getUint32(i);
          i += 4;
        }
        if (defaultSampleSizePresent) {
          result.defaultSampleSize = view.getUint32(i);
          i += 4;
        }
        if (defaultSampleFlagsPresent) {
          result.defaultSampleFlags = view.getUint32(i);
        }
        if (durationIsEmpty) {
          result.durationIsEmpty = true;
        }
        if (!baseDataOffsetPresent && defaultBaseIsMoof) {
          result.baseDataOffsetIsMoof = true;
        }
        return result;
      }, "tfhd");
      var parseTfhd = tfhd;
      var parseSampleFlags = /* @__PURE__ */ __name(function parseSampleFlags2(flags) {
        return {
          isLeading: (flags[0] & 12) >>> 2,
          dependsOn: flags[0] & 3,
          isDependedOn: (flags[1] & 192) >>> 6,
          hasRedundancy: (flags[1] & 48) >>> 4,
          paddingValue: (flags[1] & 14) >>> 1,
          isNonSyncSample: flags[1] & 1,
          degradationPriority: flags[2] << 8 | flags[3]
        };
      }, "parseSampleFlags");
      var parseSampleFlags_1 = parseSampleFlags;
      var trun = /* @__PURE__ */ __name(function trun2(data) {
        var result = {
          version: data[0],
          flags: new Uint8Array(data.subarray(1, 4)),
          samples: []
        }, view = new DataView(data.buffer, data.byteOffset, data.byteLength), dataOffsetPresent = result.flags[2] & 1, firstSampleFlagsPresent = result.flags[2] & 4, sampleDurationPresent = result.flags[1] & 1, sampleSizePresent = result.flags[1] & 2, sampleFlagsPresent = result.flags[1] & 4, sampleCompositionTimeOffsetPresent = result.flags[1] & 8, sampleCount = view.getUint32(4), offset = 8, sample;
        if (dataOffsetPresent) {
          result.dataOffset = view.getInt32(offset);
          offset += 4;
        }
        if (firstSampleFlagsPresent && sampleCount) {
          sample = {
            flags: parseSampleFlags_1(data.subarray(offset, offset + 4))
          };
          offset += 4;
          if (sampleDurationPresent) {
            sample.duration = view.getUint32(offset);
            offset += 4;
          }
          if (sampleSizePresent) {
            sample.size = view.getUint32(offset);
            offset += 4;
          }
          if (sampleCompositionTimeOffsetPresent) {
            if (result.version === 1) {
              sample.compositionTimeOffset = view.getInt32(offset);
            } else {
              sample.compositionTimeOffset = view.getUint32(offset);
            }
            offset += 4;
          }
          result.samples.push(sample);
          sampleCount--;
        }
        while (sampleCount--) {
          sample = {};
          if (sampleDurationPresent) {
            sample.duration = view.getUint32(offset);
            offset += 4;
          }
          if (sampleSizePresent) {
            sample.size = view.getUint32(offset);
            offset += 4;
          }
          if (sampleFlagsPresent) {
            sample.flags = parseSampleFlags_1(data.subarray(offset, offset + 4));
            offset += 4;
          }
          if (sampleCompositionTimeOffsetPresent) {
            if (result.version === 1) {
              sample.compositionTimeOffset = view.getInt32(offset);
            } else {
              sample.compositionTimeOffset = view.getUint32(offset);
            }
            offset += 4;
          }
          result.samples.push(sample);
        }
        return result;
      }, "trun");
      var parseTrun$1 = trun;
      var toUnsigned$1 = bin.toUnsigned;
      var getUint64$3 = numbers.getUint64;
      var tfdt = /* @__PURE__ */ __name(function tfdt2(data) {
        var result = {
          version: data[0],
          flags: new Uint8Array(data.subarray(1, 4))
        };
        if (result.version === 1) {
          result.baseMediaDecodeTime = getUint64$3(data.subarray(4));
        } else {
          result.baseMediaDecodeTime = toUnsigned$1(data[4] << 24 | data[5] << 16 | data[6] << 8 | data[7]);
        }
        return result;
      }, "tfdt");
      var parseTfdt$1 = tfdt;
      var typedArrayIndexOf$1 = /* @__PURE__ */ __name(function typedArrayIndexOf2(typedArray2, element, fromIndex) {
        if (!typedArray2) {
          return -1;
        }
        var currentIndex = fromIndex;
        for (; currentIndex < typedArray2.length; currentIndex++) {
          if (typedArray2[currentIndex] === element) {
            return currentIndex;
          }
        }
        return -1;
      }, "typedArrayIndexOf");
      var typedArray = {
        typedArrayIndexOf: typedArrayIndexOf$1
      };
      var typedArrayIndexOf = typedArray.typedArrayIndexOf, textEncodingDescriptionByte = {
        Iso88591: 0,
        // ISO-8859-1, terminated with \0.
        Utf16: 1,
        // UTF-16 encoded Unicode BOM, terminated with \0\0
        Utf16be: 2,
        // UTF-16BE encoded Unicode, without BOM, terminated with \0\0
        Utf8: 3
        // UTF-8 encoded Unicode, terminated with \0
      }, percentEncode$1 = /* @__PURE__ */ __name(function percentEncode2(bytes, start, end) {
        var i, result = "";
        for (i = start; i < end; i++) {
          result += "%" + ("00" + bytes[i].toString(16)).slice(-2);
        }
        return result;
      }, "percentEncode"), parseUtf8 = /* @__PURE__ */ __name(function parseUtf82(bytes, start, end) {
        return decodeURIComponent(percentEncode$1(bytes, start, end));
      }, "parseUtf8"), parseIso88591$1 = /* @__PURE__ */ __name(function parseIso885912(bytes, start, end) {
        return unescape(percentEncode$1(bytes, start, end));
      }, "parseIso88591"), parseSyncSafeInteger$1 = /* @__PURE__ */ __name(function parseSyncSafeInteger2(data) {
        return data[0] << 21 | data[1] << 14 | data[2] << 7 | data[3];
      }, "parseSyncSafeInteger"), frameParsers = {
        "APIC": /* @__PURE__ */ __name(function APIC(frame) {
          var i = 1, mimeTypeEndIndex, descriptionEndIndex, LINK_MIME_TYPE = "-->";
          if (frame.data[0] !== textEncodingDescriptionByte.Utf8) {
            return;
          }
          mimeTypeEndIndex = typedArrayIndexOf(frame.data, 0, i);
          if (mimeTypeEndIndex < 0) {
            return;
          }
          frame.mimeType = parseIso88591$1(frame.data, i, mimeTypeEndIndex);
          i = mimeTypeEndIndex + 1;
          frame.pictureType = frame.data[i];
          i++;
          descriptionEndIndex = typedArrayIndexOf(frame.data, 0, i);
          if (descriptionEndIndex < 0) {
            return;
          }
          frame.description = parseUtf8(frame.data, i, descriptionEndIndex);
          i = descriptionEndIndex + 1;
          if (frame.mimeType === LINK_MIME_TYPE) {
            frame.url = parseIso88591$1(frame.data, i, frame.data.length);
          } else {
            frame.pictureData = frame.data.subarray(i, frame.data.length);
          }
        }, "APIC"),
        "T*": /* @__PURE__ */ __name(function T(frame) {
          if (frame.data[0] !== textEncodingDescriptionByte.Utf8) {
            return;
          }
          frame.value = parseUtf8(frame.data, 1, frame.data.length).replace(/\0*$/, "");
          frame.values = frame.value.split("\0");
        }, "T"),
        "TXXX": /* @__PURE__ */ __name(function TXXX(frame) {
          var descriptionEndIndex;
          if (frame.data[0] !== textEncodingDescriptionByte.Utf8) {
            return;
          }
          descriptionEndIndex = typedArrayIndexOf(frame.data, 0, 1);
          if (descriptionEndIndex === -1) {
            return;
          }
          frame.description = parseUtf8(frame.data, 1, descriptionEndIndex);
          frame.value = parseUtf8(frame.data, descriptionEndIndex + 1, frame.data.length).replace(/\0*$/, "");
          frame.data = frame.value;
        }, "TXXX"),
        "W*": /* @__PURE__ */ __name(function W(frame) {
          frame.url = parseIso88591$1(frame.data, 0, frame.data.length).replace(/\0.*$/, "");
        }, "W"),
        "WXXX": /* @__PURE__ */ __name(function WXXX(frame) {
          var descriptionEndIndex;
          if (frame.data[0] !== textEncodingDescriptionByte.Utf8) {
            return;
          }
          descriptionEndIndex = typedArrayIndexOf(frame.data, 0, 1);
          if (descriptionEndIndex === -1) {
            return;
          }
          frame.description = parseUtf8(frame.data, 1, descriptionEndIndex);
          frame.url = parseIso88591$1(frame.data, descriptionEndIndex + 1, frame.data.length).replace(/\0.*$/, "");
        }, "WXXX"),
        "PRIV": /* @__PURE__ */ __name(function PRIV(frame) {
          var i;
          for (i = 0; i < frame.data.length; i++) {
            if (frame.data[i] === 0) {
              frame.owner = parseIso88591$1(frame.data, 0, i);
              break;
            }
          }
          frame.privateData = frame.data.subarray(i + 1);
          frame.data = frame.privateData;
        }, "PRIV")
      };
      var parseId3Frames$1 = /* @__PURE__ */ __name(function parseId3Frames2(data) {
        var frameSize, frameHeader, frameStart = 10, tagSize = 0, frames = [];
        if (data.length < 10 || data[0] !== "I".charCodeAt(0) || data[1] !== "D".charCodeAt(0) || data[2] !== "3".charCodeAt(0)) {
          return;
        }
        tagSize = parseSyncSafeInteger$1(data.subarray(6, 10));
        tagSize += 10;
        var hasExtendedHeader = data[5] & 64;
        if (hasExtendedHeader) {
          frameStart += 4;
          frameStart += parseSyncSafeInteger$1(data.subarray(10, 14));
          tagSize -= parseSyncSafeInteger$1(data.subarray(16, 20));
        }
        do {
          frameSize = parseSyncSafeInteger$1(data.subarray(frameStart + 4, frameStart + 8));
          if (frameSize < 1) {
            break;
          }
          frameHeader = String.fromCharCode(data[frameStart], data[frameStart + 1], data[frameStart + 2], data[frameStart + 3]);
          var frame = {
            id: frameHeader,
            data: data.subarray(frameStart + 10, frameStart + frameSize + 10)
          };
          frame.key = frame.id;
          if (frameParsers[frame.id]) {
            frameParsers[frame.id](frame);
          } else if (frame.id[0] === "T") {
            frameParsers["T*"](frame);
          } else if (frame.id[0] === "W") {
            frameParsers["W*"](frame);
          }
          frames.push(frame);
          frameStart += 10;
          frameStart += frameSize;
        } while (frameStart < tagSize);
        return frames;
      }, "parseId3Frames");
      var parseId3 = {
        parseId3Frames: parseId3Frames$1,
        parseSyncSafeInteger: parseSyncSafeInteger$1,
        frameParsers
      };
      var toUnsigned = bin.toUnsigned;
      var toHexString = bin.toHexString;
      var getUint64$2 = numbers.getUint64;
      var timescale, startTime, compositionStartTime, getVideoTrackIds, getTracks, getTimescaleFromMediaHeader$1, getEmsgID3;
      var parseId3Frames = parseId3.parseId3Frames;
      timescale = /* @__PURE__ */ __name(function timescale2(init) {
        var result = {}, traks = findBox_1(init, ["moov", "trak"]);
        return traks.reduce(function(result2, trak2) {
          var tkhd2, version, index, id, mdhd2;
          tkhd2 = findBox_1(trak2, ["tkhd"])[0];
          if (!tkhd2) {
            return null;
          }
          version = tkhd2[0];
          index = version === 0 ? 12 : 20;
          id = toUnsigned(tkhd2[index] << 24 | tkhd2[index + 1] << 16 | tkhd2[index + 2] << 8 | tkhd2[index + 3]);
          mdhd2 = findBox_1(trak2, ["mdia", "mdhd"])[0];
          if (!mdhd2) {
            return null;
          }
          version = mdhd2[0];
          index = version === 0 ? 12 : 20;
          result2[id] = toUnsigned(mdhd2[index] << 24 | mdhd2[index + 1] << 16 | mdhd2[index + 2] << 8 | mdhd2[index + 3]);
          return result2;
        }, result);
      }, "timescale");
      startTime = /* @__PURE__ */ __name(function startTime2(timescale2, fragment) {
        var trafs;
        trafs = findBox_1(fragment, ["moof", "traf"]);
        var lowestTime = trafs.reduce(function(acc, traf2) {
          var tfhd2 = findBox_1(traf2, ["tfhd"])[0];
          var id = toUnsigned(tfhd2[4] << 24 | tfhd2[5] << 16 | tfhd2[6] << 8 | tfhd2[7]);
          var scale = timescale2[id] || 9e4;
          var tfdt2 = findBox_1(traf2, ["tfdt"])[0];
          var dv = new DataView(tfdt2.buffer, tfdt2.byteOffset, tfdt2.byteLength);
          var baseTime;
          if (tfdt2[0] === 1) {
            baseTime = getUint64$2(tfdt2.subarray(4, 12));
          } else {
            baseTime = dv.getUint32(4);
          }
          var seconds;
          if (typeof baseTime === "bigint") {
            seconds = baseTime / window__default["default"].BigInt(scale);
          } else if (typeof baseTime === "number" && !isNaN(baseTime)) {
            seconds = baseTime / scale;
          }
          if (seconds < Number.MAX_SAFE_INTEGER) {
            seconds = Number(seconds);
          }
          if (seconds < acc) {
            acc = seconds;
          }
          return acc;
        }, Infinity);
        return typeof lowestTime === "bigint" || isFinite(lowestTime) ? lowestTime : 0;
      }, "startTime");
      compositionStartTime = /* @__PURE__ */ __name(function compositionStartTime2(timescales, fragment) {
        var trafBoxes = findBox_1(fragment, ["moof", "traf"]);
        var baseMediaDecodeTime = 0;
        var compositionTimeOffset = 0;
        var trackId;
        if (trafBoxes && trafBoxes.length) {
          var tfhd2 = findBox_1(trafBoxes[0], ["tfhd"])[0];
          var trun2 = findBox_1(trafBoxes[0], ["trun"])[0];
          var tfdt2 = findBox_1(trafBoxes[0], ["tfdt"])[0];
          if (tfhd2) {
            var parsedTfhd = parseTfhd(tfhd2);
            trackId = parsedTfhd.trackId;
          }
          if (tfdt2) {
            var parsedTfdt = parseTfdt$1(tfdt2);
            baseMediaDecodeTime = parsedTfdt.baseMediaDecodeTime;
          }
          if (trun2) {
            var parsedTrun = parseTrun$1(trun2);
            if (parsedTrun.samples && parsedTrun.samples.length) {
              compositionTimeOffset = parsedTrun.samples[0].compositionTimeOffset || 0;
            }
          }
        }
        var timescale2 = timescales[trackId] || 9e4;
        if (typeof baseMediaDecodeTime === "bigint") {
          compositionTimeOffset = window__default["default"].BigInt(compositionTimeOffset);
          timescale2 = window__default["default"].BigInt(timescale2);
        }
        var result = (baseMediaDecodeTime + compositionTimeOffset) / timescale2;
        if (typeof result === "bigint" && result < Number.MAX_SAFE_INTEGER) {
          result = Number(result);
        }
        return result;
      }, "compositionStartTime");
      getVideoTrackIds = /* @__PURE__ */ __name(function getVideoTrackIds2(init) {
        var traks = findBox_1(init, ["moov", "trak"]);
        var videoTrackIds = [];
        traks.forEach(function(trak2) {
          var hdlrs = findBox_1(trak2, ["mdia", "hdlr"]);
          var tkhds = findBox_1(trak2, ["tkhd"]);
          hdlrs.forEach(function(hdlr2, index) {
            var handlerType = parseType_1(hdlr2.subarray(8, 12));
            var tkhd2 = tkhds[index];
            var view;
            var version;
            var trackId;
            if (handlerType === "vide") {
              view = new DataView(tkhd2.buffer, tkhd2.byteOffset, tkhd2.byteLength);
              version = view.getUint8(0);
              trackId = version === 0 ? view.getUint32(12) : view.getUint32(20);
              videoTrackIds.push(trackId);
            }
          });
        });
        return videoTrackIds;
      }, "getVideoTrackIds");
      getTimescaleFromMediaHeader$1 = /* @__PURE__ */ __name(function getTimescaleFromMediaHeader2(mdhd2) {
        var version = mdhd2[0];
        var index = version === 0 ? 12 : 20;
        return toUnsigned(mdhd2[index] << 24 | mdhd2[index + 1] << 16 | mdhd2[index + 2] << 8 | mdhd2[index + 3]);
      }, "getTimescaleFromMediaHeader");
      getTracks = /* @__PURE__ */ __name(function getTracks2(init) {
        var traks = findBox_1(init, ["moov", "trak"]);
        var tracks = [];
        traks.forEach(function(trak2) {
          var track = {};
          var tkhd2 = findBox_1(trak2, ["tkhd"])[0];
          var view, tkhdVersion;
          if (tkhd2) {
            view = new DataView(tkhd2.buffer, tkhd2.byteOffset, tkhd2.byteLength);
            tkhdVersion = view.getUint8(0);
            track.id = tkhdVersion === 0 ? view.getUint32(12) : view.getUint32(20);
          }
          var hdlr2 = findBox_1(trak2, ["mdia", "hdlr"])[0];
          if (hdlr2) {
            var type2 = parseType_1(hdlr2.subarray(8, 12));
            if (type2 === "vide") {
              track.type = "video";
            } else if (type2 === "soun") {
              track.type = "audio";
            } else {
              track.type = type2;
            }
          }
          var stsd2 = findBox_1(trak2, ["mdia", "minf", "stbl", "stsd"])[0];
          if (stsd2) {
            var sampleDescriptions = stsd2.subarray(8);
            track.codec = parseType_1(sampleDescriptions.subarray(4, 8));
            var codecBox = findBox_1(sampleDescriptions, [track.codec])[0];
            var codecConfig, codecConfigType;
            if (codecBox) {
              if (/^[asm]vc[1-9]$/i.test(track.codec)) {
                codecConfig = codecBox.subarray(78);
                codecConfigType = parseType_1(codecConfig.subarray(4, 8));
                if (codecConfigType === "avcC" && codecConfig.length > 11) {
                  track.codec += ".";
                  track.codec += toHexString(codecConfig[9]);
                  track.codec += toHexString(codecConfig[10]);
                  track.codec += toHexString(codecConfig[11]);
                } else {
                  track.codec = "avc1.4d400d";
                }
              } else if (/^mp4[a,v]$/i.test(track.codec)) {
                codecConfig = codecBox.subarray(28);
                codecConfigType = parseType_1(codecConfig.subarray(4, 8));
                if (codecConfigType === "esds" && codecConfig.length > 20 && codecConfig[19] !== 0) {
                  track.codec += "." + toHexString(codecConfig[19]);
                  track.codec += "." + toHexString(codecConfig[20] >>> 2 & 63).replace(/^0/, "");
                } else {
                  track.codec = "mp4a.40.2";
                }
              } else {
                track.codec = track.codec.toLowerCase();
              }
            }
          }
          var mdhd2 = findBox_1(trak2, ["mdia", "mdhd"])[0];
          if (mdhd2) {
            track.timescale = getTimescaleFromMediaHeader$1(mdhd2);
          }
          tracks.push(track);
        });
        return tracks;
      }, "getTracks");
      getEmsgID3 = /* @__PURE__ */ __name(function getEmsgID32(segmentData, offset) {
        if (offset === void 0) {
          offset = 0;
        }
        var emsgBoxes = findBox_1(segmentData, ["emsg"]);
        return emsgBoxes.map(function(data) {
          var parsedBox = emsg.parseEmsgBox(new Uint8Array(data));
          var parsedId3Frames = parseId3Frames(parsedBox.message_data);
          return {
            cueTime: emsg.scaleTime(parsedBox.presentation_time, parsedBox.timescale, parsedBox.presentation_time_delta, offset),
            duration: emsg.scaleTime(parsedBox.event_duration, parsedBox.timescale),
            frames: parsedId3Frames
          };
        });
      }, "getEmsgID3");
      var probe$2 = {
        // export mp4 inspector's findBox and parseType for backwards compatibility
        findBox: findBox_1,
        parseType: parseType_1,
        timescale,
        startTime,
        compositionStartTime,
        videoTrackIds: getVideoTrackIds,
        tracks: getTracks,
        getTimescaleFromMediaHeader: getTimescaleFromMediaHeader$1,
        getEmsgID3
      };
      var groupNalsIntoFrames = /* @__PURE__ */ __name(function groupNalsIntoFrames2(nalUnits) {
        var i, currentNal, currentFrame = [], frames = [];
        frames.byteLength = 0;
        frames.nalCount = 0;
        frames.duration = 0;
        currentFrame.byteLength = 0;
        for (i = 0; i < nalUnits.length; i++) {
          currentNal = nalUnits[i];
          if (currentNal.nalUnitType === "access_unit_delimiter_rbsp") {
            if (currentFrame.length) {
              currentFrame.duration = currentNal.dts - currentFrame.dts;
              frames.byteLength += currentFrame.byteLength;
              frames.nalCount += currentFrame.length;
              frames.duration += currentFrame.duration;
              frames.push(currentFrame);
            }
            currentFrame = [currentNal];
            currentFrame.byteLength = currentNal.data.byteLength;
            currentFrame.pts = currentNal.pts;
            currentFrame.dts = currentNal.dts;
          } else {
            if (currentNal.nalUnitType === "slice_layer_without_partitioning_rbsp_idr") {
              currentFrame.keyFrame = true;
            }
            currentFrame.duration = currentNal.dts - currentFrame.dts;
            currentFrame.byteLength += currentNal.data.byteLength;
            currentFrame.push(currentNal);
          }
        }
        if (frames.length && (!currentFrame.duration || currentFrame.duration <= 0)) {
          currentFrame.duration = frames[frames.length - 1].duration;
        }
        frames.byteLength += currentFrame.byteLength;
        frames.nalCount += currentFrame.length;
        frames.duration += currentFrame.duration;
        frames.push(currentFrame);
        return frames;
      }, "groupNalsIntoFrames");
      var groupFramesIntoGops = /* @__PURE__ */ __name(function groupFramesIntoGops2(frames) {
        var i, currentFrame, currentGop = [], gops = [];
        currentGop.byteLength = 0;
        currentGop.nalCount = 0;
        currentGop.duration = 0;
        currentGop.pts = frames[0].pts;
        currentGop.dts = frames[0].dts;
        gops.byteLength = 0;
        gops.nalCount = 0;
        gops.duration = 0;
        gops.pts = frames[0].pts;
        gops.dts = frames[0].dts;
        for (i = 0; i < frames.length; i++) {
          currentFrame = frames[i];
          if (currentFrame.keyFrame) {
            if (currentGop.length) {
              gops.push(currentGop);
              gops.byteLength += currentGop.byteLength;
              gops.nalCount += currentGop.nalCount;
              gops.duration += currentGop.duration;
            }
            currentGop = [currentFrame];
            currentGop.nalCount = currentFrame.length;
            currentGop.byteLength = currentFrame.byteLength;
            currentGop.pts = currentFrame.pts;
            currentGop.dts = currentFrame.dts;
            currentGop.duration = currentFrame.duration;
          } else {
            currentGop.duration += currentFrame.duration;
            currentGop.nalCount += currentFrame.length;
            currentGop.byteLength += currentFrame.byteLength;
            currentGop.push(currentFrame);
          }
        }
        if (gops.length && currentGop.duration <= 0) {
          currentGop.duration = gops[gops.length - 1].duration;
        }
        gops.byteLength += currentGop.byteLength;
        gops.nalCount += currentGop.nalCount;
        gops.duration += currentGop.duration;
        gops.push(currentGop);
        return gops;
      }, "groupFramesIntoGops");
      var extendFirstKeyFrame = /* @__PURE__ */ __name(function extendFirstKeyFrame2(gops) {
        var currentGop;
        if (!gops[0][0].keyFrame && gops.length > 1) {
          currentGop = gops.shift();
          gops.byteLength -= currentGop.byteLength;
          gops.nalCount -= currentGop.nalCount;
          gops[0][0].dts = currentGop.dts;
          gops[0][0].pts = currentGop.pts;
          gops[0][0].duration += currentGop.duration;
        }
        return gops;
      }, "extendFirstKeyFrame");
      var createDefaultSample = /* @__PURE__ */ __name(function createDefaultSample2() {
        return {
          size: 0,
          flags: {
            isLeading: 0,
            dependsOn: 1,
            isDependedOn: 0,
            hasRedundancy: 0,
            degradationPriority: 0,
            isNonSyncSample: 1
          }
        };
      }, "createDefaultSample");
      var sampleForFrame = /* @__PURE__ */ __name(function sampleForFrame2(frame, dataOffset) {
        var sample = createDefaultSample();
        sample.dataOffset = dataOffset;
        sample.compositionTimeOffset = frame.pts - frame.dts;
        sample.duration = frame.duration;
        sample.size = 4 * frame.length;
        sample.size += frame.byteLength;
        if (frame.keyFrame) {
          sample.flags.dependsOn = 2;
          sample.flags.isNonSyncSample = 0;
        }
        return sample;
      }, "sampleForFrame");
      var generateSampleTable$1 = /* @__PURE__ */ __name(function generateSampleTable2(gops, baseDataOffset) {
        var h, i, sample, currentGop, currentFrame, dataOffset = baseDataOffset || 0, samples2 = [];
        for (h = 0; h < gops.length; h++) {
          currentGop = gops[h];
          for (i = 0; i < currentGop.length; i++) {
            currentFrame = currentGop[i];
            sample = sampleForFrame(currentFrame, dataOffset);
            dataOffset += sample.size;
            samples2.push(sample);
          }
        }
        return samples2;
      }, "generateSampleTable");
      var concatenateNalData = /* @__PURE__ */ __name(function concatenateNalData2(gops) {
        var h, i, j, currentGop, currentFrame, currentNal, dataOffset = 0, nalsByteLength = gops.byteLength, numberOfNals = gops.nalCount, totalByteLength = nalsByteLength + 4 * numberOfNals, data = new Uint8Array(totalByteLength), view = new DataView(data.buffer);
        for (h = 0; h < gops.length; h++) {
          currentGop = gops[h];
          for (i = 0; i < currentGop.length; i++) {
            currentFrame = currentGop[i];
            for (j = 0; j < currentFrame.length; j++) {
              currentNal = currentFrame[j];
              view.setUint32(dataOffset, currentNal.data.byteLength);
              dataOffset += 4;
              data.set(currentNal.data, dataOffset);
              dataOffset += currentNal.data.byteLength;
            }
          }
        }
        return data;
      }, "concatenateNalData");
      var generateSampleTableForFrame = /* @__PURE__ */ __name(function generateSampleTableForFrame2(frame, baseDataOffset) {
        var sample, dataOffset = baseDataOffset || 0, samples2 = [];
        sample = sampleForFrame(frame, dataOffset);
        samples2.push(sample);
        return samples2;
      }, "generateSampleTableForFrame");
      var concatenateNalDataForFrame = /* @__PURE__ */ __name(function concatenateNalDataForFrame2(frame) {
        var i, currentNal, dataOffset = 0, nalsByteLength = frame.byteLength, numberOfNals = frame.length, totalByteLength = nalsByteLength + 4 * numberOfNals, data = new Uint8Array(totalByteLength), view = new DataView(data.buffer);
        for (i = 0; i < frame.length; i++) {
          currentNal = frame[i];
          view.setUint32(dataOffset, currentNal.data.byteLength);
          dataOffset += 4;
          data.set(currentNal.data, dataOffset);
          dataOffset += currentNal.data.byteLength;
        }
        return data;
      }, "concatenateNalDataForFrame");
      var frameUtils = {
        groupNalsIntoFrames,
        groupFramesIntoGops,
        extendFirstKeyFrame,
        generateSampleTable: generateSampleTable$1,
        concatenateNalData,
        generateSampleTableForFrame,
        concatenateNalDataForFrame
      };
      var highPrefix = [33, 16, 5, 32, 164, 27];
      var lowPrefix = [33, 65, 108, 84, 1, 2, 4, 8, 168, 2, 4, 8, 17, 191, 252];
      var zeroFill = /* @__PURE__ */ __name(function zeroFill2(count) {
        var a = [];
        while (count--) {
          a.push(0);
        }
        return a;
      }, "zeroFill");
      var makeTable = /* @__PURE__ */ __name(function makeTable2(metaTable) {
        return Object.keys(metaTable).reduce(function(obj, key) {
          obj[key] = new Uint8Array(metaTable[key].reduce(function(arr, part) {
            return arr.concat(part);
          }, []));
          return obj;
        }, {});
      }, "makeTable");
      var silence;
      var silence_1 = /* @__PURE__ */ __name(function silence_12() {
        if (!silence) {
          var coneOfSilence = {
            96e3: [highPrefix, [227, 64], zeroFill(154), [56]],
            88200: [highPrefix, [231], zeroFill(170), [56]],
            64e3: [highPrefix, [248, 192], zeroFill(240), [56]],
            48e3: [highPrefix, [255, 192], zeroFill(268), [55, 148, 128], zeroFill(54), [112]],
            44100: [highPrefix, [255, 192], zeroFill(268), [55, 163, 128], zeroFill(84), [112]],
            32e3: [highPrefix, [255, 192], zeroFill(268), [55, 234], zeroFill(226), [112]],
            24e3: [highPrefix, [255, 192], zeroFill(268), [55, 255, 128], zeroFill(268), [111, 112], zeroFill(126), [224]],
            16e3: [highPrefix, [255, 192], zeroFill(268), [55, 255, 128], zeroFill(268), [111, 255], zeroFill(269), [223, 108], zeroFill(195), [1, 192]],
            12e3: [lowPrefix, zeroFill(268), [3, 127, 248], zeroFill(268), [6, 255, 240], zeroFill(268), [13, 255, 224], zeroFill(268), [27, 253, 128], zeroFill(259), [56]],
            11025: [lowPrefix, zeroFill(268), [3, 127, 248], zeroFill(268), [6, 255, 240], zeroFill(268), [13, 255, 224], zeroFill(268), [27, 255, 192], zeroFill(268), [55, 175, 128], zeroFill(108), [112]],
            8e3: [lowPrefix, zeroFill(268), [3, 121, 16], zeroFill(47), [7]]
          };
          silence = makeTable(coneOfSilence);
        }
        return silence;
      }, "silence_1");
      var sumFrameByteLengths = /* @__PURE__ */ __name(function sumFrameByteLengths2(array2) {
        var i, currentObj, sum = 0;
        for (i = 0; i < array2.length; i++) {
          currentObj = array2[i];
          sum += currentObj.data.byteLength;
        }
        return sum;
      }, "sumFrameByteLengths");
      var prefixWithSilence = /* @__PURE__ */ __name(function prefixWithSilence2(track, frames, audioAppendStartTs, videoBaseMediaDecodeTime) {
        var baseMediaDecodeTimeTs, frameDuration = 0, audioGapDuration = 0, audioFillFrameCount = 0, audioFillDuration = 0, silentFrame, i, firstFrame;
        if (!frames.length) {
          return;
        }
        baseMediaDecodeTimeTs = clock.audioTsToVideoTs(track.baseMediaDecodeTime, track.samplerate);
        frameDuration = Math.ceil(clock.ONE_SECOND_IN_TS / (track.samplerate / 1024));
        if (audioAppendStartTs && videoBaseMediaDecodeTime) {
          audioGapDuration = baseMediaDecodeTimeTs - Math.max(audioAppendStartTs, videoBaseMediaDecodeTime);
          audioFillFrameCount = Math.floor(audioGapDuration / frameDuration);
          audioFillDuration = audioFillFrameCount * frameDuration;
        }
        if (audioFillFrameCount < 1 || audioFillDuration > clock.ONE_SECOND_IN_TS / 2) {
          return;
        }
        silentFrame = silence_1()[track.samplerate];
        if (!silentFrame) {
          silentFrame = frames[0].data;
        }
        for (i = 0; i < audioFillFrameCount; i++) {
          firstFrame = frames[0];
          frames.splice(0, 0, {
            data: silentFrame,
            dts: firstFrame.dts - frameDuration,
            pts: firstFrame.pts - frameDuration
          });
        }
        track.baseMediaDecodeTime -= Math.floor(clock.videoTsToAudioTs(audioFillDuration, track.samplerate));
        return audioFillDuration;
      }, "prefixWithSilence");
      var trimAdtsFramesByEarliestDts = /* @__PURE__ */ __name(function trimAdtsFramesByEarliestDts2(adtsFrames, track, earliestAllowedDts) {
        if (track.minSegmentDts >= earliestAllowedDts) {
          return adtsFrames;
        }
        track.minSegmentDts = Infinity;
        return adtsFrames.filter(function(currentFrame) {
          if (currentFrame.dts >= earliestAllowedDts) {
            track.minSegmentDts = Math.min(track.minSegmentDts, currentFrame.dts);
            track.minSegmentPts = track.minSegmentDts;
            return true;
          }
          return false;
        });
      }, "trimAdtsFramesByEarliestDts");
      var generateSampleTable = /* @__PURE__ */ __name(function generateSampleTable2(frames) {
        var i, currentFrame, samples2 = [];
        for (i = 0; i < frames.length; i++) {
          currentFrame = frames[i];
          samples2.push({
            size: currentFrame.data.byteLength,
            duration: 1024
            // For AAC audio, all samples contain 1024 samples
          });
        }
        return samples2;
      }, "generateSampleTable");
      var concatenateFrameData = /* @__PURE__ */ __name(function concatenateFrameData2(frames) {
        var i, currentFrame, dataOffset = 0, data = new Uint8Array(sumFrameByteLengths(frames));
        for (i = 0; i < frames.length; i++) {
          currentFrame = frames[i];
          data.set(currentFrame.data, dataOffset);
          dataOffset += currentFrame.data.byteLength;
        }
        return data;
      }, "concatenateFrameData");
      var audioFrameUtils = {
        prefixWithSilence,
        trimAdtsFramesByEarliestDts,
        generateSampleTable,
        concatenateFrameData
      };
      var ONE_SECOND_IN_TS$3 = clock.ONE_SECOND_IN_TS;
      var collectDtsInfo = /* @__PURE__ */ __name(function collectDtsInfo2(track, data) {
        if (typeof data.pts === "number") {
          if (track.timelineStartInfo.pts === void 0) {
            track.timelineStartInfo.pts = data.pts;
          }
          if (track.minSegmentPts === void 0) {
            track.minSegmentPts = data.pts;
          } else {
            track.minSegmentPts = Math.min(track.minSegmentPts, data.pts);
          }
          if (track.maxSegmentPts === void 0) {
            track.maxSegmentPts = data.pts;
          } else {
            track.maxSegmentPts = Math.max(track.maxSegmentPts, data.pts);
          }
        }
        if (typeof data.dts === "number") {
          if (track.timelineStartInfo.dts === void 0) {
            track.timelineStartInfo.dts = data.dts;
          }
          if (track.minSegmentDts === void 0) {
            track.minSegmentDts = data.dts;
          } else {
            track.minSegmentDts = Math.min(track.minSegmentDts, data.dts);
          }
          if (track.maxSegmentDts === void 0) {
            track.maxSegmentDts = data.dts;
          } else {
            track.maxSegmentDts = Math.max(track.maxSegmentDts, data.dts);
          }
        }
      }, "collectDtsInfo");
      var clearDtsInfo = /* @__PURE__ */ __name(function clearDtsInfo2(track) {
        delete track.minSegmentDts;
        delete track.maxSegmentDts;
        delete track.minSegmentPts;
        delete track.maxSegmentPts;
      }, "clearDtsInfo");
      var calculateTrackBaseMediaDecodeTime = /* @__PURE__ */ __name(function calculateTrackBaseMediaDecodeTime2(track, keepOriginalTimestamps) {
        var baseMediaDecodeTime, scale, minSegmentDts = track.minSegmentDts;
        if (!keepOriginalTimestamps) {
          minSegmentDts -= track.timelineStartInfo.dts;
        }
        baseMediaDecodeTime = track.timelineStartInfo.baseMediaDecodeTime;
        baseMediaDecodeTime += minSegmentDts;
        baseMediaDecodeTime = Math.max(0, baseMediaDecodeTime);
        if (track.type === "audio") {
          scale = track.samplerate / ONE_SECOND_IN_TS$3;
          baseMediaDecodeTime *= scale;
          baseMediaDecodeTime = Math.floor(baseMediaDecodeTime);
        }
        return baseMediaDecodeTime;
      }, "calculateTrackBaseMediaDecodeTime");
      var trackDecodeInfo = {
        clearDtsInfo,
        calculateTrackBaseMediaDecodeTime,
        collectDtsInfo
      };
      var USER_DATA_REGISTERED_ITU_T_T35 = 4, RBSP_TRAILING_BITS = 128;
      var parseSei = /* @__PURE__ */ __name(function parseSei2(bytes) {
        var i = 0, result = {
          payloadType: -1,
          payloadSize: 0
        }, payloadType = 0, payloadSize = 0;
        while (i < bytes.byteLength) {
          if (bytes[i] === RBSP_TRAILING_BITS) {
            break;
          }
          while (bytes[i] === 255) {
            payloadType += 255;
            i++;
          }
          payloadType += bytes[i++];
          while (bytes[i] === 255) {
            payloadSize += 255;
            i++;
          }
          payloadSize += bytes[i++];
          if (!result.payload && payloadType === USER_DATA_REGISTERED_ITU_T_T35) {
            var userIdentifier = String.fromCharCode(bytes[i + 3], bytes[i + 4], bytes[i + 5], bytes[i + 6]);
            if (userIdentifier === "GA94") {
              result.payloadType = payloadType;
              result.payloadSize = payloadSize;
              result.payload = bytes.subarray(i, i + payloadSize);
              break;
            } else {
              result.payload = void 0;
            }
          }
          i += payloadSize;
          payloadType = 0;
          payloadSize = 0;
        }
        return result;
      }, "parseSei");
      var parseUserData = /* @__PURE__ */ __name(function parseUserData2(sei) {
        if (sei.payload[0] !== 181) {
          return null;
        }
        if ((sei.payload[1] << 8 | sei.payload[2]) !== 49) {
          return null;
        }
        if (String.fromCharCode(sei.payload[3], sei.payload[4], sei.payload[5], sei.payload[6]) !== "GA94") {
          return null;
        }
        if (sei.payload[7] !== 3) {
          return null;
        }
        return sei.payload.subarray(8, sei.payload.length - 1);
      }, "parseUserData");
      var parseCaptionPackets = /* @__PURE__ */ __name(function parseCaptionPackets2(pts, userData) {
        var results = [], i, count, offset, data;
        if (!(userData[0] & 64)) {
          return results;
        }
        count = userData[0] & 31;
        for (i = 0; i < count; i++) {
          offset = i * 3;
          data = {
            type: userData[offset + 2] & 3,
            pts
          };
          if (userData[offset + 2] & 4) {
            data.ccData = userData[offset + 3] << 8 | userData[offset + 4];
            results.push(data);
          }
        }
        return results;
      }, "parseCaptionPackets");
      var discardEmulationPreventionBytes$1 = /* @__PURE__ */ __name(function discardEmulationPreventionBytes2(data) {
        var length = data.byteLength, emulationPreventionBytesPositions = [], i = 1, newLength, newData;
        while (i < length - 2) {
          if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 3) {
            emulationPreventionBytesPositions.push(i + 2);
            i += 2;
          } else {
            i++;
          }
        }
        if (emulationPreventionBytesPositions.length === 0) {
          return data;
        }
        newLength = length - emulationPreventionBytesPositions.length;
        newData = new Uint8Array(newLength);
        var sourceIndex = 0;
        for (i = 0; i < newLength; sourceIndex++, i++) {
          if (sourceIndex === emulationPreventionBytesPositions[0]) {
            sourceIndex++;
            emulationPreventionBytesPositions.shift();
          }
          newData[i] = data[sourceIndex];
        }
        return newData;
      }, "discardEmulationPreventionBytes");
      var captionPacketParser = {
        parseSei,
        parseUserData,
        parseCaptionPackets,
        discardEmulationPreventionBytes: discardEmulationPreventionBytes$1,
        USER_DATA_REGISTERED_ITU_T_T35
      };
      var CaptionStream$1 = /* @__PURE__ */ __name(function CaptionStream2(options) {
        options = options || {};
        CaptionStream2.prototype.init.call(this);
        this.parse708captions_ = typeof options.parse708captions === "boolean" ? options.parse708captions : true;
        this.captionPackets_ = [];
        this.ccStreams_ = [
          new Cea608Stream(0, 0),
          // eslint-disable-line no-use-before-define
          new Cea608Stream(0, 1),
          // eslint-disable-line no-use-before-define
          new Cea608Stream(1, 0),
          // eslint-disable-line no-use-before-define
          new Cea608Stream(1, 1)
          // eslint-disable-line no-use-before-define
        ];
        if (this.parse708captions_) {
          this.cc708Stream_ = new Cea708Stream({
            captionServices: options.captionServices
          });
        }
        this.reset();
        this.ccStreams_.forEach(function(cc) {
          cc.on("data", this.trigger.bind(this, "data"));
          cc.on("partialdone", this.trigger.bind(this, "partialdone"));
          cc.on("done", this.trigger.bind(this, "done"));
        }, this);
        if (this.parse708captions_) {
          this.cc708Stream_.on("data", this.trigger.bind(this, "data"));
          this.cc708Stream_.on("partialdone", this.trigger.bind(this, "partialdone"));
          this.cc708Stream_.on("done", this.trigger.bind(this, "done"));
        }
      }, "CaptionStream");
      CaptionStream$1.prototype = new stream();
      CaptionStream$1.prototype.push = function(event) {
        var sei, userData, newCaptionPackets;
        if (event.nalUnitType !== "sei_rbsp") {
          return;
        }
        sei = captionPacketParser.parseSei(event.escapedRBSP);
        if (!sei.payload) {
          return;
        }
        if (sei.payloadType !== captionPacketParser.USER_DATA_REGISTERED_ITU_T_T35) {
          return;
        }
        userData = captionPacketParser.parseUserData(sei);
        if (!userData) {
          return;
        }
        if (event.dts < this.latestDts_) {
          this.ignoreNextEqualDts_ = true;
          return;
        } else if (event.dts === this.latestDts_ && this.ignoreNextEqualDts_) {
          this.numSameDts_--;
          if (!this.numSameDts_) {
            this.ignoreNextEqualDts_ = false;
          }
          return;
        }
        newCaptionPackets = captionPacketParser.parseCaptionPackets(event.pts, userData);
        this.captionPackets_ = this.captionPackets_.concat(newCaptionPackets);
        if (this.latestDts_ !== event.dts) {
          this.numSameDts_ = 0;
        }
        this.numSameDts_++;
        this.latestDts_ = event.dts;
      };
      CaptionStream$1.prototype.flushCCStreams = function(flushType) {
        this.ccStreams_.forEach(function(cc) {
          return flushType === "flush" ? cc.flush() : cc.partialFlush();
        }, this);
      };
      CaptionStream$1.prototype.flushStream = function(flushType) {
        if (!this.captionPackets_.length) {
          this.flushCCStreams(flushType);
          return;
        }
        this.captionPackets_.forEach(function(elem, idx) {
          elem.presortIndex = idx;
        });
        this.captionPackets_.sort(function(a, b) {
          if (a.pts === b.pts) {
            return a.presortIndex - b.presortIndex;
          }
          return a.pts - b.pts;
        });
        this.captionPackets_.forEach(function(packet) {
          if (packet.type < 2) {
            this.dispatchCea608Packet(packet);
          } else {
            this.dispatchCea708Packet(packet);
          }
        }, this);
        this.captionPackets_.length = 0;
        this.flushCCStreams(flushType);
      };
      CaptionStream$1.prototype.flush = function() {
        return this.flushStream("flush");
      };
      CaptionStream$1.prototype.partialFlush = function() {
        return this.flushStream("partialFlush");
      };
      CaptionStream$1.prototype.reset = function() {
        this.latestDts_ = null;
        this.ignoreNextEqualDts_ = false;
        this.numSameDts_ = 0;
        this.activeCea608Channel_ = [null, null];
        this.ccStreams_.forEach(function(ccStream) {
          ccStream.reset();
        });
      };
      CaptionStream$1.prototype.dispatchCea608Packet = function(packet) {
        if (this.setsTextOrXDSActive(packet)) {
          this.activeCea608Channel_[packet.type] = null;
        } else if (this.setsChannel1Active(packet)) {
          this.activeCea608Channel_[packet.type] = 0;
        } else if (this.setsChannel2Active(packet)) {
          this.activeCea608Channel_[packet.type] = 1;
        }
        if (this.activeCea608Channel_[packet.type] === null) {
          return;
        }
        this.ccStreams_[(packet.type << 1) + this.activeCea608Channel_[packet.type]].push(packet);
      };
      CaptionStream$1.prototype.setsChannel1Active = function(packet) {
        return (packet.ccData & 30720) === 4096;
      };
      CaptionStream$1.prototype.setsChannel2Active = function(packet) {
        return (packet.ccData & 30720) === 6144;
      };
      CaptionStream$1.prototype.setsTextOrXDSActive = function(packet) {
        return (packet.ccData & 28928) === 256 || (packet.ccData & 30974) === 4138 || (packet.ccData & 30974) === 6186;
      };
      CaptionStream$1.prototype.dispatchCea708Packet = function(packet) {
        if (this.parse708captions_) {
          this.cc708Stream_.push(packet);
        }
      };
      var CHARACTER_TRANSLATION_708 = {
        127: 9834,
        // ♪
        4128: 32,
        // Transparent Space
        4129: 160,
        // Nob-breaking Transparent Space
        4133: 8230,
        // …
        4138: 352,
        // Š
        4140: 338,
        // Œ
        4144: 9608,
        // █
        4145: 8216,
        // ‘
        4146: 8217,
        // ’
        4147: 8220,
        // “
        4148: 8221,
        // ”
        4149: 8226,
        // •
        4153: 8482,
        // ™
        4154: 353,
        // š
        4156: 339,
        // œ
        4157: 8480,
        // ℠
        4159: 376,
        // Ÿ
        4214: 8539,
        // ⅛
        4215: 8540,
        // ⅜
        4216: 8541,
        // ⅝
        4217: 8542,
        // ⅞
        4218: 9168,
        // ⏐
        4219: 9124,
        // ⎤
        4220: 9123,
        // ⎣
        4221: 9135,
        // ⎯
        4222: 9126,
        // ⎦
        4223: 9121,
        // ⎡
        4256: 12600
        // ㄸ (CC char)
      };
      var get708CharFromCode = /* @__PURE__ */ __name(function get708CharFromCode2(code) {
        var newCode = CHARACTER_TRANSLATION_708[code] || code;
        if (code & 4096 && code === newCode) {
          return "";
        }
        return String.fromCharCode(newCode);
      }, "get708CharFromCode");
      var within708TextBlock = /* @__PURE__ */ __name(function within708TextBlock2(b) {
        return 32 <= b && b <= 127 || 160 <= b && b <= 255;
      }, "within708TextBlock");
      var Cea708Window = /* @__PURE__ */ __name(function Cea708Window2(windowNum) {
        this.windowNum = windowNum;
        this.reset();
      }, "Cea708Window");
      Cea708Window.prototype.reset = function() {
        this.clearText();
        this.pendingNewLine = false;
        this.winAttr = {};
        this.penAttr = {};
        this.penLoc = {};
        this.penColor = {};
        this.visible = 0;
        this.rowLock = 0;
        this.columnLock = 0;
        this.priority = 0;
        this.relativePositioning = 0;
        this.anchorVertical = 0;
        this.anchorHorizontal = 0;
        this.anchorPoint = 0;
        this.rowCount = 1;
        this.virtualRowCount = this.rowCount + 1;
        this.columnCount = 41;
        this.windowStyle = 0;
        this.penStyle = 0;
      };
      Cea708Window.prototype.getText = function() {
        return this.rows.join("\n");
      };
      Cea708Window.prototype.clearText = function() {
        this.rows = [""];
        this.rowIdx = 0;
      };
      Cea708Window.prototype.newLine = function(pts) {
        if (this.rows.length >= this.virtualRowCount && typeof this.beforeRowOverflow === "function") {
          this.beforeRowOverflow(pts);
        }
        if (this.rows.length > 0) {
          this.rows.push("");
          this.rowIdx++;
        }
        while (this.rows.length > this.virtualRowCount) {
          this.rows.shift();
          this.rowIdx--;
        }
      };
      Cea708Window.prototype.isEmpty = function() {
        if (this.rows.length === 0) {
          return true;
        } else if (this.rows.length === 1) {
          return this.rows[0] === "";
        }
        return false;
      };
      Cea708Window.prototype.addText = function(text) {
        this.rows[this.rowIdx] += text;
      };
      Cea708Window.prototype.backspace = function() {
        if (!this.isEmpty()) {
          var row = this.rows[this.rowIdx];
          this.rows[this.rowIdx] = row.substr(0, row.length - 1);
        }
      };
      var Cea708Service = /* @__PURE__ */ __name(function Cea708Service2(serviceNum, encoding, stream2) {
        this.serviceNum = serviceNum;
        this.text = "";
        this.currentWindow = new Cea708Window(-1);
        this.windows = [];
        this.stream = stream2;
        if (typeof encoding === "string") {
          this.createTextDecoder(encoding);
        }
      }, "Cea708Service");
      Cea708Service.prototype.init = function(pts, beforeRowOverflow) {
        this.startPts = pts;
        for (var win = 0; win < 8; win++) {
          this.windows[win] = new Cea708Window(win);
          if (typeof beforeRowOverflow === "function") {
            this.windows[win].beforeRowOverflow = beforeRowOverflow;
          }
        }
      };
      Cea708Service.prototype.setCurrentWindow = function(windowNum) {
        this.currentWindow = this.windows[windowNum];
      };
      Cea708Service.prototype.createTextDecoder = function(encoding) {
        if (typeof TextDecoder === "undefined") {
          this.stream.trigger("log", {
            level: "warn",
            message: "The `encoding` option is unsupported without TextDecoder support"
          });
        } else {
          try {
            this.textDecoder_ = new TextDecoder(encoding);
          } catch (error) {
            this.stream.trigger("log", {
              level: "warn",
              message: "TextDecoder could not be created with " + encoding + " encoding. " + error
            });
          }
        }
      };
      var Cea708Stream = /* @__PURE__ */ __name(function Cea708Stream2(options) {
        options = options || {};
        Cea708Stream2.prototype.init.call(this);
        var self2 = this;
        var captionServices = options.captionServices || {};
        var captionServiceEncodings = {};
        var serviceProps;
        Object.keys(captionServices).forEach(function(serviceName) {
          serviceProps = captionServices[serviceName];
          if (/^SERVICE/.test(serviceName)) {
            captionServiceEncodings[serviceName] = serviceProps.encoding;
          }
        });
        this.serviceEncodings = captionServiceEncodings;
        this.current708Packet = null;
        this.services = {};
        this.push = function(packet) {
          if (packet.type === 3) {
            self2.new708Packet();
            self2.add708Bytes(packet);
          } else {
            if (self2.current708Packet === null) {
              self2.new708Packet();
            }
            self2.add708Bytes(packet);
          }
        };
      }, "Cea708Stream");
      Cea708Stream.prototype = new stream();
      Cea708Stream.prototype.new708Packet = function() {
        if (this.current708Packet !== null) {
          this.push708Packet();
        }
        this.current708Packet = {
          data: [],
          ptsVals: []
        };
      };
      Cea708Stream.prototype.add708Bytes = function(packet) {
        var data = packet.ccData;
        var byte0 = data >>> 8;
        var byte1 = data & 255;
        this.current708Packet.ptsVals.push(packet.pts);
        this.current708Packet.data.push(byte0);
        this.current708Packet.data.push(byte1);
      };
      Cea708Stream.prototype.push708Packet = function() {
        var packet708 = this.current708Packet;
        var packetData = packet708.data;
        var serviceNum = null;
        var blockSize = null;
        var i = 0;
        var b = packetData[i++];
        packet708.seq = b >> 6;
        packet708.sizeCode = b & 63;
        for (; i < packetData.length; i++) {
          b = packetData[i++];
          serviceNum = b >> 5;
          blockSize = b & 31;
          if (serviceNum === 7 && blockSize > 0) {
            b = packetData[i++];
            serviceNum = b;
          }
          this.pushServiceBlock(serviceNum, i, blockSize);
          if (blockSize > 0) {
            i += blockSize - 1;
          }
        }
      };
      Cea708Stream.prototype.pushServiceBlock = function(serviceNum, start, size) {
        var b;
        var i = start;
        var packetData = this.current708Packet.data;
        var service = this.services[serviceNum];
        if (!service) {
          service = this.initService(serviceNum, i);
        }
        for (; i < start + size && i < packetData.length; i++) {
          b = packetData[i];
          if (within708TextBlock(b)) {
            i = this.handleText(i, service);
          } else if (b === 24) {
            i = this.multiByteCharacter(i, service);
          } else if (b === 16) {
            i = this.extendedCommands(i, service);
          } else if (128 <= b && b <= 135) {
            i = this.setCurrentWindow(i, service);
          } else if (152 <= b && b <= 159) {
            i = this.defineWindow(i, service);
          } else if (b === 136) {
            i = this.clearWindows(i, service);
          } else if (b === 140) {
            i = this.deleteWindows(i, service);
          } else if (b === 137) {
            i = this.displayWindows(i, service);
          } else if (b === 138) {
            i = this.hideWindows(i, service);
          } else if (b === 139) {
            i = this.toggleWindows(i, service);
          } else if (b === 151) {
            i = this.setWindowAttributes(i, service);
          } else if (b === 144) {
            i = this.setPenAttributes(i, service);
          } else if (b === 145) {
            i = this.setPenColor(i, service);
          } else if (b === 146) {
            i = this.setPenLocation(i, service);
          } else if (b === 143) {
            service = this.reset(i, service);
          } else if (b === 8) {
            service.currentWindow.backspace();
          } else if (b === 12) {
            service.currentWindow.clearText();
          } else if (b === 13) {
            service.currentWindow.pendingNewLine = true;
          } else if (b === 14) {
            service.currentWindow.clearText();
          } else if (b === 141) {
            i++;
          } else ;
        }
      };
      Cea708Stream.prototype.extendedCommands = function(i, service) {
        var packetData = this.current708Packet.data;
        var b = packetData[++i];
        if (within708TextBlock(b)) {
          i = this.handleText(i, service, {
            isExtended: true
          });
        }
        return i;
      };
      Cea708Stream.prototype.getPts = function(byteIndex) {
        return this.current708Packet.ptsVals[Math.floor(byteIndex / 2)];
      };
      Cea708Stream.prototype.initService = function(serviceNum, i) {
        var serviceName = "SERVICE" + serviceNum;
        var self2 = this;
        var serviceName;
        var encoding;
        if (serviceName in this.serviceEncodings) {
          encoding = this.serviceEncodings[serviceName];
        }
        this.services[serviceNum] = new Cea708Service(serviceNum, encoding, self2);
        this.services[serviceNum].init(this.getPts(i), function(pts) {
          self2.flushDisplayed(pts, self2.services[serviceNum]);
        });
        return this.services[serviceNum];
      };
      Cea708Stream.prototype.handleText = function(i, service, options) {
        var isExtended = options && options.isExtended;
        var isMultiByte = options && options.isMultiByte;
        var packetData = this.current708Packet.data;
        var extended = isExtended ? 4096 : 0;
        var currentByte = packetData[i];
        var nextByte = packetData[i + 1];
        var win = service.currentWindow;
        var char;
        var charCodeArray;
        function toHexString2(byteArray) {
          return byteArray.map(function(byte) {
            return ("0" + (byte & 255).toString(16)).slice(-2);
          }).join("");
        }
        __name(toHexString2, "toHexString");
        if (isMultiByte) {
          charCodeArray = [currentByte, nextByte];
          i++;
        } else {
          charCodeArray = [currentByte];
        }
        if (service.textDecoder_ && !isExtended) {
          char = service.textDecoder_.decode(new Uint8Array(charCodeArray));
        } else {
          if (isMultiByte) {
            var unicode = toHexString2(charCodeArray);
            char = String.fromCharCode(parseInt(unicode, 16));
          } else {
            char = get708CharFromCode(extended | currentByte);
          }
        }
        if (win.pendingNewLine && !win.isEmpty()) {
          win.newLine(this.getPts(i));
        }
        win.pendingNewLine = false;
        win.addText(char);
        return i;
      };
      Cea708Stream.prototype.multiByteCharacter = function(i, service) {
        var packetData = this.current708Packet.data;
        var firstByte = packetData[i + 1];
        var secondByte = packetData[i + 2];
        if (within708TextBlock(firstByte) && within708TextBlock(secondByte)) {
          i = this.handleText(++i, service, {
            isMultiByte: true
          });
        }
        return i;
      };
      Cea708Stream.prototype.setCurrentWindow = function(i, service) {
        var packetData = this.current708Packet.data;
        var b = packetData[i];
        var windowNum = b & 7;
        service.setCurrentWindow(windowNum);
        return i;
      };
      Cea708Stream.prototype.defineWindow = function(i, service) {
        var packetData = this.current708Packet.data;
        var b = packetData[i];
        var windowNum = b & 7;
        service.setCurrentWindow(windowNum);
        var win = service.currentWindow;
        b = packetData[++i];
        win.visible = (b & 32) >> 5;
        win.rowLock = (b & 16) >> 4;
        win.columnLock = (b & 8) >> 3;
        win.priority = b & 7;
        b = packetData[++i];
        win.relativePositioning = (b & 128) >> 7;
        win.anchorVertical = b & 127;
        b = packetData[++i];
        win.anchorHorizontal = b;
        b = packetData[++i];
        win.anchorPoint = (b & 240) >> 4;
        win.rowCount = b & 15;
        b = packetData[++i];
        win.columnCount = b & 63;
        b = packetData[++i];
        win.windowStyle = (b & 56) >> 3;
        win.penStyle = b & 7;
        win.virtualRowCount = win.rowCount + 1;
        return i;
      };
      Cea708Stream.prototype.setWindowAttributes = function(i, service) {
        var packetData = this.current708Packet.data;
        var b = packetData[i];
        var winAttr = service.currentWindow.winAttr;
        b = packetData[++i];
        winAttr.fillOpacity = (b & 192) >> 6;
        winAttr.fillRed = (b & 48) >> 4;
        winAttr.fillGreen = (b & 12) >> 2;
        winAttr.fillBlue = b & 3;
        b = packetData[++i];
        winAttr.borderType = (b & 192) >> 6;
        winAttr.borderRed = (b & 48) >> 4;
        winAttr.borderGreen = (b & 12) >> 2;
        winAttr.borderBlue = b & 3;
        b = packetData[++i];
        winAttr.borderType += (b & 128) >> 5;
        winAttr.wordWrap = (b & 64) >> 6;
        winAttr.printDirection = (b & 48) >> 4;
        winAttr.scrollDirection = (b & 12) >> 2;
        winAttr.justify = b & 3;
        b = packetData[++i];
        winAttr.effectSpeed = (b & 240) >> 4;
        winAttr.effectDirection = (b & 12) >> 2;
        winAttr.displayEffect = b & 3;
        return i;
      };
      Cea708Stream.prototype.flushDisplayed = function(pts, service) {
        var displayedText = [];
        for (var winId = 0; winId < 8; winId++) {
          if (service.windows[winId].visible && !service.windows[winId].isEmpty()) {
            displayedText.push(service.windows[winId].getText());
          }
        }
        service.endPts = pts;
        service.text = displayedText.join("\n\n");
        this.pushCaption(service);
        service.startPts = pts;
      };
      Cea708Stream.prototype.pushCaption = function(service) {
        if (service.text !== "") {
          this.trigger("data", {
            startPts: service.startPts,
            endPts: service.endPts,
            text: service.text,
            stream: "cc708_" + service.serviceNum
          });
          service.text = "";
          service.startPts = service.endPts;
        }
      };
      Cea708Stream.prototype.displayWindows = function(i, service) {
        var packetData = this.current708Packet.data;
        var b = packetData[++i];
        var pts = this.getPts(i);
        this.flushDisplayed(pts, service);
        for (var winId = 0; winId < 8; winId++) {
          if (b & 1 << winId) {
            service.windows[winId].visible = 1;
          }
        }
        return i;
      };
      Cea708Stream.prototype.hideWindows = function(i, service) {
        var packetData = this.current708Packet.data;
        var b = packetData[++i];
        var pts = this.getPts(i);
        this.flushDisplayed(pts, service);
        for (var winId = 0; winId < 8; winId++) {
          if (b & 1 << winId) {
            service.windows[winId].visible = 0;
          }
        }
        return i;
      };
      Cea708Stream.prototype.toggleWindows = function(i, service) {
        var packetData = this.current708Packet.data;
        var b = packetData[++i];
        var pts = this.getPts(i);
        this.flushDisplayed(pts, service);
        for (var winId = 0; winId < 8; winId++) {
          if (b & 1 << winId) {
            service.windows[winId].visible ^= 1;
          }
        }
        return i;
      };
      Cea708Stream.prototype.clearWindows = function(i, service) {
        var packetData = this.current708Packet.data;
        var b = packetData[++i];
        var pts = this.getPts(i);
        this.flushDisplayed(pts, service);
        for (var winId = 0; winId < 8; winId++) {
          if (b & 1 << winId) {
            service.windows[winId].clearText();
          }
        }
        return i;
      };
      Cea708Stream.prototype.deleteWindows = function(i, service) {
        var packetData = this.current708Packet.data;
        var b = packetData[++i];
        var pts = this.getPts(i);
        this.flushDisplayed(pts, service);
        for (var winId = 0; winId < 8; winId++) {
          if (b & 1 << winId) {
            service.windows[winId].reset();
          }
        }
        return i;
      };
      Cea708Stream.prototype.setPenAttributes = function(i, service) {
        var packetData = this.current708Packet.data;
        var b = packetData[i];
        var penAttr = service.currentWindow.penAttr;
        b = packetData[++i];
        penAttr.textTag = (b & 240) >> 4;
        penAttr.offset = (b & 12) >> 2;
        penAttr.penSize = b & 3;
        b = packetData[++i];
        penAttr.italics = (b & 128) >> 7;
        penAttr.underline = (b & 64) >> 6;
        penAttr.edgeType = (b & 56) >> 3;
        penAttr.fontStyle = b & 7;
        return i;
      };
      Cea708Stream.prototype.setPenColor = function(i, service) {
        var packetData = this.current708Packet.data;
        var b = packetData[i];
        var penColor = service.currentWindow.penColor;
        b = packetData[++i];
        penColor.fgOpacity = (b & 192) >> 6;
        penColor.fgRed = (b & 48) >> 4;
        penColor.fgGreen = (b & 12) >> 2;
        penColor.fgBlue = b & 3;
        b = packetData[++i];
        penColor.bgOpacity = (b & 192) >> 6;
        penColor.bgRed = (b & 48) >> 4;
        penColor.bgGreen = (b & 12) >> 2;
        penColor.bgBlue = b & 3;
        b = packetData[++i];
        penColor.edgeRed = (b & 48) >> 4;
        penColor.edgeGreen = (b & 12) >> 2;
        penColor.edgeBlue = b & 3;
        return i;
      };
      Cea708Stream.prototype.setPenLocation = function(i, service) {
        var packetData = this.current708Packet.data;
        var b = packetData[i];
        var penLoc = service.currentWindow.penLoc;
        service.currentWindow.pendingNewLine = true;
        b = packetData[++i];
        penLoc.row = b & 15;
        b = packetData[++i];
        penLoc.column = b & 63;
        return i;
      };
      Cea708Stream.prototype.reset = function(i, service) {
        var pts = this.getPts(i);
        this.flushDisplayed(pts, service);
        return this.initService(service.serviceNum, i);
      };
      var CHARACTER_TRANSLATION = {
        42: 225,
        // á
        92: 233,
        // é
        94: 237,
        // í
        95: 243,
        // ó
        96: 250,
        // ú
        123: 231,
        // ç
        124: 247,
        // ÷
        125: 209,
        // Ñ
        126: 241,
        // ñ
        127: 9608,
        // █
        304: 174,
        // ®
        305: 176,
        // °
        306: 189,
        // ½
        307: 191,
        // ¿
        308: 8482,
        // ™
        309: 162,
        // ¢
        310: 163,
        // £
        311: 9834,
        // ♪
        312: 224,
        // à
        313: 160,
        //
        314: 232,
        // è
        315: 226,
        // â
        316: 234,
        // ê
        317: 238,
        // î
        318: 244,
        // ô
        319: 251,
        // û
        544: 193,
        // Á
        545: 201,
        // É
        546: 211,
        // Ó
        547: 218,
        // Ú
        548: 220,
        // Ü
        549: 252,
        // ü
        550: 8216,
        // ‘
        551: 161,
        // ¡
        552: 42,
        // *
        553: 39,
        // '
        554: 8212,
        // —
        555: 169,
        // ©
        556: 8480,
        // ℠
        557: 8226,
        // •
        558: 8220,
        // “
        559: 8221,
        // ”
        560: 192,
        // À
        561: 194,
        // Â
        562: 199,
        // Ç
        563: 200,
        // È
        564: 202,
        // Ê
        565: 203,
        // Ë
        566: 235,
        // ë
        567: 206,
        // Î
        568: 207,
        // Ï
        569: 239,
        // ï
        570: 212,
        // Ô
        571: 217,
        // Ù
        572: 249,
        // ù
        573: 219,
        // Û
        574: 171,
        // «
        575: 187,
        // »
        800: 195,
        // Ã
        801: 227,
        // ã
        802: 205,
        // Í
        803: 204,
        // Ì
        804: 236,
        // ì
        805: 210,
        // Ò
        806: 242,
        // ò
        807: 213,
        // Õ
        808: 245,
        // õ
        809: 123,
        // {
        810: 125,
        // }
        811: 92,
        // \
        812: 94,
        // ^
        813: 95,
        // _
        814: 124,
        // |
        815: 126,
        // ~
        816: 196,
        // Ä
        817: 228,
        // ä
        818: 214,
        // Ö
        819: 246,
        // ö
        820: 223,
        // ß
        821: 165,
        // ¥
        822: 164,
        // ¤
        823: 9474,
        // │
        824: 197,
        // Å
        825: 229,
        // å
        826: 216,
        // Ø
        827: 248,
        // ø
        828: 9484,
        // ┌
        829: 9488,
        // ┐
        830: 9492,
        // └
        831: 9496
        // ┘
      };
      var getCharFromCode = /* @__PURE__ */ __name(function getCharFromCode2(code) {
        if (code === null) {
          return "";
        }
        code = CHARACTER_TRANSLATION[code] || code;
        return String.fromCharCode(code);
      }, "getCharFromCode");
      var BOTTOM_ROW = 14;
      var ROWS = [4352, 4384, 4608, 4640, 5376, 5408, 5632, 5664, 5888, 5920, 4096, 4864, 4896, 5120, 5152];
      var createDisplayBuffer = /* @__PURE__ */ __name(function createDisplayBuffer2() {
        var result = [], i = BOTTOM_ROW + 1;
        while (i--) {
          result.push({
            text: "",
            indent: 0,
            offset: 0
          });
        }
        return result;
      }, "createDisplayBuffer");
      var Cea608Stream = /* @__PURE__ */ __name(function Cea608Stream2(field, dataChannel) {
        Cea608Stream2.prototype.init.call(this);
        this.field_ = field || 0;
        this.dataChannel_ = dataChannel || 0;
        this.name_ = "CC" + ((this.field_ << 1 | this.dataChannel_) + 1);
        this.setConstants();
        this.reset();
        this.push = function(packet) {
          var data, swap, char0, char1, text;
          data = packet.ccData & 32639;
          if (data === this.lastControlCode_) {
            this.lastControlCode_ = null;
            return;
          }
          if ((data & 61440) === 4096) {
            this.lastControlCode_ = data;
          } else if (data !== this.PADDING_) {
            this.lastControlCode_ = null;
          }
          char0 = data >>> 8;
          char1 = data & 255;
          if (data === this.PADDING_) {
            return;
          } else if (data === this.RESUME_CAPTION_LOADING_) {
            this.mode_ = "popOn";
          } else if (data === this.END_OF_CAPTION_) {
            this.mode_ = "popOn";
            this.clearFormatting(packet.pts);
            this.flushDisplayed(packet.pts);
            swap = this.displayed_;
            this.displayed_ = this.nonDisplayed_;
            this.nonDisplayed_ = swap;
            this.startPts_ = packet.pts;
          } else if (data === this.ROLL_UP_2_ROWS_) {
            this.rollUpRows_ = 2;
            this.setRollUp(packet.pts);
          } else if (data === this.ROLL_UP_3_ROWS_) {
            this.rollUpRows_ = 3;
            this.setRollUp(packet.pts);
          } else if (data === this.ROLL_UP_4_ROWS_) {
            this.rollUpRows_ = 4;
            this.setRollUp(packet.pts);
          } else if (data === this.CARRIAGE_RETURN_) {
            this.clearFormatting(packet.pts);
            this.flushDisplayed(packet.pts);
            this.shiftRowsUp_();
            this.startPts_ = packet.pts;
          } else if (data === this.BACKSPACE_) {
            if (this.mode_ === "popOn") {
              this.nonDisplayed_[this.row_].text = this.nonDisplayed_[this.row_].text.slice(0, -1);
            } else {
              this.displayed_[this.row_].text = this.displayed_[this.row_].text.slice(0, -1);
            }
          } else if (data === this.ERASE_DISPLAYED_MEMORY_) {
            this.flushDisplayed(packet.pts);
            this.displayed_ = createDisplayBuffer();
          } else if (data === this.ERASE_NON_DISPLAYED_MEMORY_) {
            this.nonDisplayed_ = createDisplayBuffer();
          } else if (data === this.RESUME_DIRECT_CAPTIONING_) {
            if (this.mode_ !== "paintOn") {
              this.flushDisplayed(packet.pts);
              this.displayed_ = createDisplayBuffer();
            }
            this.mode_ = "paintOn";
            this.startPts_ = packet.pts;
          } else if (this.isSpecialCharacter(char0, char1)) {
            char0 = (char0 & 3) << 8;
            text = getCharFromCode(char0 | char1);
            this[this.mode_](packet.pts, text);
            this.column_++;
          } else if (this.isExtCharacter(char0, char1)) {
            if (this.mode_ === "popOn") {
              this.nonDisplayed_[this.row_].text = this.nonDisplayed_[this.row_].text.slice(0, -1);
            } else {
              this.displayed_[this.row_].text = this.displayed_[this.row_].text.slice(0, -1);
            }
            char0 = (char0 & 3) << 8;
            text = getCharFromCode(char0 | char1);
            this[this.mode_](packet.pts, text);
            this.column_++;
          } else if (this.isMidRowCode(char0, char1)) {
            this.clearFormatting(packet.pts);
            this[this.mode_](packet.pts, " ");
            this.column_++;
            if ((char1 & 14) === 14) {
              this.addFormatting(packet.pts, ["i"]);
            }
            if ((char1 & 1) === 1) {
              this.addFormatting(packet.pts, ["u"]);
            }
          } else if (this.isOffsetControlCode(char0, char1)) {
            var offset = char1 & 3;
            this.nonDisplayed_[this.row_].offset = offset;
            this.column_ += offset;
          } else if (this.isPAC(char0, char1)) {
            var row = ROWS.indexOf(data & 7968);
            if (this.mode_ === "rollUp") {
              if (row - this.rollUpRows_ + 1 < 0) {
                row = this.rollUpRows_ - 1;
              }
              this.setRollUp(packet.pts, row);
            }
            if (row !== this.row_ && row >= 0 && row <= 14) {
              this.clearFormatting(packet.pts);
              this.row_ = row;
            }
            if (char1 & 1 && this.formatting_.indexOf("u") === -1) {
              this.addFormatting(packet.pts, ["u"]);
            }
            if ((data & 16) === 16) {
              var indentations = (data & 14) >> 1;
              this.column_ = indentations * 4;
              this.nonDisplayed_[this.row_].indent += indentations;
            }
            if (this.isColorPAC(char1)) {
              if ((char1 & 14) === 14) {
                this.addFormatting(packet.pts, ["i"]);
              }
            }
          } else if (this.isNormalChar(char0)) {
            if (char1 === 0) {
              char1 = null;
            }
            text = getCharFromCode(char0);
            text += getCharFromCode(char1);
            this[this.mode_](packet.pts, text);
            this.column_ += text.length;
          }
        };
      }, "Cea608Stream");
      Cea608Stream.prototype = new stream();
      Cea608Stream.prototype.flushDisplayed = function(pts) {
        var _this = this;
        var logWarning = /* @__PURE__ */ __name(function logWarning2(index) {
          _this.trigger("log", {
            level: "warn",
            message: "Skipping a malformed 608 caption at index " + index + "."
          });
        }, "logWarning");
        var content = [];
        this.displayed_.forEach(function(row, i) {
          if (row && row.text && row.text.length) {
            try {
              row.text = row.text.trim();
            } catch (e) {
              logWarning(i);
            }
            if (row.text.length) {
              content.push({
                // The text to be displayed in the caption from this specific row, with whitespace removed.
                text: row.text,
                // Value between 1 and 15 representing the PAC row used to calculate line height.
                line: i + 1,
                // A number representing the indent position by percentage (CEA-608 PAC indent code).
                // The value will be a number between 10 and 80. Offset is used to add an aditional
                // value to the position if necessary.
                position: 10 + Math.min(70, row.indent * 10) + row.offset * 2.5
              });
            }
          } else if (row === void 0 || row === null) {
            logWarning(i);
          }
        });
        if (content.length) {
          this.trigger("data", {
            startPts: this.startPts_,
            endPts: pts,
            content,
            stream: this.name_
          });
        }
      };
      Cea608Stream.prototype.reset = function() {
        this.mode_ = "popOn";
        this.topRow_ = 0;
        this.startPts_ = 0;
        this.displayed_ = createDisplayBuffer();
        this.nonDisplayed_ = createDisplayBuffer();
        this.lastControlCode_ = null;
        this.column_ = 0;
        this.row_ = BOTTOM_ROW;
        this.rollUpRows_ = 2;
        this.formatting_ = [];
      };
      Cea608Stream.prototype.setConstants = function() {
        if (this.dataChannel_ === 0) {
          this.BASE_ = 16;
          this.EXT_ = 17;
          this.CONTROL_ = (20 | this.field_) << 8;
          this.OFFSET_ = 23;
        } else if (this.dataChannel_ === 1) {
          this.BASE_ = 24;
          this.EXT_ = 25;
          this.CONTROL_ = (28 | this.field_) << 8;
          this.OFFSET_ = 31;
        }
        this.PADDING_ = 0;
        this.RESUME_CAPTION_LOADING_ = this.CONTROL_ | 32;
        this.END_OF_CAPTION_ = this.CONTROL_ | 47;
        this.ROLL_UP_2_ROWS_ = this.CONTROL_ | 37;
        this.ROLL_UP_3_ROWS_ = this.CONTROL_ | 38;
        this.ROLL_UP_4_ROWS_ = this.CONTROL_ | 39;
        this.CARRIAGE_RETURN_ = this.CONTROL_ | 45;
        this.RESUME_DIRECT_CAPTIONING_ = this.CONTROL_ | 41;
        this.BACKSPACE_ = this.CONTROL_ | 33;
        this.ERASE_DISPLAYED_MEMORY_ = this.CONTROL_ | 44;
        this.ERASE_NON_DISPLAYED_MEMORY_ = this.CONTROL_ | 46;
      };
      Cea608Stream.prototype.isSpecialCharacter = function(char0, char1) {
        return char0 === this.EXT_ && char1 >= 48 && char1 <= 63;
      };
      Cea608Stream.prototype.isExtCharacter = function(char0, char1) {
        return (char0 === this.EXT_ + 1 || char0 === this.EXT_ + 2) && char1 >= 32 && char1 <= 63;
      };
      Cea608Stream.prototype.isMidRowCode = function(char0, char1) {
        return char0 === this.EXT_ && char1 >= 32 && char1 <= 47;
      };
      Cea608Stream.prototype.isOffsetControlCode = function(char0, char1) {
        return char0 === this.OFFSET_ && char1 >= 33 && char1 <= 35;
      };
      Cea608Stream.prototype.isPAC = function(char0, char1) {
        return char0 >= this.BASE_ && char0 < this.BASE_ + 8 && char1 >= 64 && char1 <= 127;
      };
      Cea608Stream.prototype.isColorPAC = function(char1) {
        return char1 >= 64 && char1 <= 79 || char1 >= 96 && char1 <= 127;
      };
      Cea608Stream.prototype.isNormalChar = function(char) {
        return char >= 32 && char <= 127;
      };
      Cea608Stream.prototype.setRollUp = function(pts, newBaseRow) {
        if (this.mode_ !== "rollUp") {
          this.row_ = BOTTOM_ROW;
          this.mode_ = "rollUp";
          this.flushDisplayed(pts);
          this.nonDisplayed_ = createDisplayBuffer();
          this.displayed_ = createDisplayBuffer();
        }
        if (newBaseRow !== void 0 && newBaseRow !== this.row_) {
          for (var i = 0; i < this.rollUpRows_; i++) {
            this.displayed_[newBaseRow - i] = this.displayed_[this.row_ - i];
            this.displayed_[this.row_ - i] = {
              text: "",
              indent: 0,
              offset: 0
            };
          }
        }
        if (newBaseRow === void 0) {
          newBaseRow = this.row_;
        }
        this.topRow_ = newBaseRow - this.rollUpRows_ + 1;
      };
      Cea608Stream.prototype.addFormatting = function(pts, format) {
        this.formatting_ = this.formatting_.concat(format);
        var text = format.reduce(function(text2, format2) {
          return text2 + "<" + format2 + ">";
        }, "");
        this[this.mode_](pts, text);
      };
      Cea608Stream.prototype.clearFormatting = function(pts) {
        if (!this.formatting_.length) {
          return;
        }
        var text = this.formatting_.reverse().reduce(function(text2, format) {
          return text2 + "</" + format + ">";
        }, "");
        this.formatting_ = [];
        this[this.mode_](pts, text);
      };
      Cea608Stream.prototype.popOn = function(pts, text) {
        var baseRow = this.nonDisplayed_[this.row_].text;
        baseRow += text;
        this.nonDisplayed_[this.row_].text = baseRow;
      };
      Cea608Stream.prototype.rollUp = function(pts, text) {
        var baseRow = this.displayed_[this.row_].text;
        baseRow += text;
        this.displayed_[this.row_].text = baseRow;
      };
      Cea608Stream.prototype.shiftRowsUp_ = function() {
        var i;
        for (i = 0; i < this.topRow_; i++) {
          this.displayed_[i] = {
            text: "",
            indent: 0,
            offset: 0
          };
        }
        for (i = this.row_ + 1; i < BOTTOM_ROW + 1; i++) {
          this.displayed_[i] = {
            text: "",
            indent: 0,
            offset: 0
          };
        }
        for (i = this.topRow_; i < this.row_; i++) {
          this.displayed_[i] = this.displayed_[i + 1];
        }
        this.displayed_[this.row_] = {
          text: "",
          indent: 0,
          offset: 0
        };
      };
      Cea608Stream.prototype.paintOn = function(pts, text) {
        var baseRow = this.displayed_[this.row_].text;
        baseRow += text;
        this.displayed_[this.row_].text = baseRow;
      };
      var captionStream = {
        CaptionStream: CaptionStream$1,
        Cea608Stream,
        Cea708Stream
      };
      var streamTypes = {
        H264_STREAM_TYPE: 27,
        ADTS_STREAM_TYPE: 15,
        METADATA_STREAM_TYPE: 21
      };
      var MAX_TS = 8589934592;
      var RO_THRESH = 4294967296;
      var TYPE_SHARED = "shared";
      var handleRollover$1 = /* @__PURE__ */ __name(function handleRollover2(value, reference) {
        var direction = 1;
        if (value > reference) {
          direction = -1;
        }
        while (Math.abs(reference - value) > RO_THRESH) {
          value += direction * MAX_TS;
        }
        return value;
      }, "handleRollover");
      var TimestampRolloverStream$1 = /* @__PURE__ */ __name(function TimestampRolloverStream2(type2) {
        var lastDTS, referenceDTS;
        TimestampRolloverStream2.prototype.init.call(this);
        this.type_ = type2 || TYPE_SHARED;
        this.push = function(data) {
          if (data.type === "metadata") {
            this.trigger("data", data);
            return;
          }
          if (this.type_ !== TYPE_SHARED && data.type !== this.type_) {
            return;
          }
          if (referenceDTS === void 0) {
            referenceDTS = data.dts;
          }
          data.dts = handleRollover$1(data.dts, referenceDTS);
          data.pts = handleRollover$1(data.pts, referenceDTS);
          lastDTS = data.dts;
          this.trigger("data", data);
        };
        this.flush = function() {
          referenceDTS = lastDTS;
          this.trigger("done");
        };
        this.endTimeline = function() {
          this.flush();
          this.trigger("endedtimeline");
        };
        this.discontinuity = function() {
          referenceDTS = void 0;
          lastDTS = void 0;
        };
        this.reset = function() {
          this.discontinuity();
          this.trigger("reset");
        };
      }, "TimestampRolloverStream");
      TimestampRolloverStream$1.prototype = new stream();
      var timestampRolloverStream = {
        TimestampRolloverStream: TimestampRolloverStream$1,
        handleRollover: handleRollover$1
      };
      var _MetadataStream;
      _MetadataStream = /* @__PURE__ */ __name(function MetadataStream(options) {
        var settings = {
          // the bytes of the program-level descriptor field in MP2T
          // see ISO/IEC 13818-1:2013 (E), section 2.6 "Program and
          // program element descriptors"
          descriptor: options && options.descriptor
        }, tagSize = 0, buffer = [], bufferSize = 0, i;
        _MetadataStream.prototype.init.call(this);
        this.dispatchType = streamTypes.METADATA_STREAM_TYPE.toString(16);
        if (settings.descriptor) {
          for (i = 0; i < settings.descriptor.length; i++) {
            this.dispatchType += ("00" + settings.descriptor[i].toString(16)).slice(-2);
          }
        }
        this.push = function(chunk) {
          var tag, frameStart, frameSize, frame, i2, frameHeader;
          if (chunk.type !== "timed-metadata") {
            return;
          }
          if (chunk.dataAlignmentIndicator) {
            bufferSize = 0;
            buffer.length = 0;
          }
          if (buffer.length === 0 && (chunk.data.length < 10 || chunk.data[0] !== "I".charCodeAt(0) || chunk.data[1] !== "D".charCodeAt(0) || chunk.data[2] !== "3".charCodeAt(0))) {
            this.trigger("log", {
              level: "warn",
              message: "Skipping unrecognized metadata packet"
            });
            return;
          }
          buffer.push(chunk);
          bufferSize += chunk.data.byteLength;
          if (buffer.length === 1) {
            tagSize = parseId3.parseSyncSafeInteger(chunk.data.subarray(6, 10));
            tagSize += 10;
          }
          if (bufferSize < tagSize) {
            return;
          }
          tag = {
            data: new Uint8Array(tagSize),
            frames: [],
            pts: buffer[0].pts,
            dts: buffer[0].dts
          };
          for (i2 = 0; i2 < tagSize; ) {
            tag.data.set(buffer[0].data.subarray(0, tagSize - i2), i2);
            i2 += buffer[0].data.byteLength;
            bufferSize -= buffer[0].data.byteLength;
            buffer.shift();
          }
          frameStart = 10;
          if (tag.data[5] & 64) {
            frameStart += 4;
            frameStart += parseId3.parseSyncSafeInteger(tag.data.subarray(10, 14));
            tagSize -= parseId3.parseSyncSafeInteger(tag.data.subarray(16, 20));
          }
          do {
            frameSize = parseId3.parseSyncSafeInteger(tag.data.subarray(frameStart + 4, frameStart + 8));
            if (frameSize < 1) {
              this.trigger("log", {
                level: "warn",
                message: "Malformed ID3 frame encountered. Skipping remaining metadata parsing."
              });
              break;
            }
            frameHeader = String.fromCharCode(tag.data[frameStart], tag.data[frameStart + 1], tag.data[frameStart + 2], tag.data[frameStart + 3]);
            frame = {
              id: frameHeader,
              data: tag.data.subarray(frameStart + 10, frameStart + frameSize + 10)
            };
            frame.key = frame.id;
            if (parseId3.frameParsers[frame.id]) {
              parseId3.frameParsers[frame.id](frame);
            } else if (frame.id[0] === "T") {
              parseId3.frameParsers["T*"](frame);
            } else if (frame.id[0] === "W") {
              parseId3.frameParsers["W*"](frame);
            }
            if (frame.owner === "com.apple.streaming.transportStreamTimestamp") {
              var d = frame.data, size = (d[3] & 1) << 30 | d[4] << 22 | d[5] << 14 | d[6] << 6 | d[7] >>> 2;
              size *= 4;
              size += d[7] & 3;
              frame.timeStamp = size;
              if (tag.pts === void 0 && tag.dts === void 0) {
                tag.pts = frame.timeStamp;
                tag.dts = frame.timeStamp;
              }
              this.trigger("timestamp", frame);
            }
            tag.frames.push(frame);
            frameStart += 10;
            frameStart += frameSize;
          } while (frameStart < tagSize);
          this.trigger("data", tag);
        };
      }, "MetadataStream");
      _MetadataStream.prototype = new stream();
      var metadataStream = _MetadataStream;
      var TimestampRolloverStream = timestampRolloverStream.TimestampRolloverStream;
      var _TransportPacketStream, _TransportParseStream, _ElementaryStream;
      var MP2T_PACKET_LENGTH$1 = 188, SYNC_BYTE$1 = 71;
      _TransportPacketStream = /* @__PURE__ */ __name(function TransportPacketStream() {
        var buffer = new Uint8Array(MP2T_PACKET_LENGTH$1), bytesInBuffer = 0;
        _TransportPacketStream.prototype.init.call(this);
        this.push = function(bytes) {
          var startIndex = 0, endIndex = MP2T_PACKET_LENGTH$1, everything;
          if (bytesInBuffer) {
            everything = new Uint8Array(bytes.byteLength + bytesInBuffer);
            everything.set(buffer.subarray(0, bytesInBuffer));
            everything.set(bytes, bytesInBuffer);
            bytesInBuffer = 0;
          } else {
            everything = bytes;
          }
          while (endIndex < everything.byteLength) {
            if (everything[startIndex] === SYNC_BYTE$1 && everything[endIndex] === SYNC_BYTE$1) {
              this.trigger("data", everything.subarray(startIndex, endIndex));
              startIndex += MP2T_PACKET_LENGTH$1;
              endIndex += MP2T_PACKET_LENGTH$1;
              continue;
            }
            startIndex++;
            endIndex++;
          }
          if (startIndex < everything.byteLength) {
            buffer.set(everything.subarray(startIndex), 0);
            bytesInBuffer = everything.byteLength - startIndex;
          }
        };
        this.flush = function() {
          if (bytesInBuffer === MP2T_PACKET_LENGTH$1 && buffer[0] === SYNC_BYTE$1) {
            this.trigger("data", buffer);
            bytesInBuffer = 0;
          }
          this.trigger("done");
        };
        this.endTimeline = function() {
          this.flush();
          this.trigger("endedtimeline");
        };
        this.reset = function() {
          bytesInBuffer = 0;
          this.trigger("reset");
        };
      }, "TransportPacketStream");
      _TransportPacketStream.prototype = new stream();
      _TransportParseStream = /* @__PURE__ */ __name(function TransportParseStream() {
        var parsePsi, parsePat2, parsePmt2, self2;
        _TransportParseStream.prototype.init.call(this);
        self2 = this;
        this.packetsWaitingForPmt = [];
        this.programMapTable = void 0;
        parsePsi = /* @__PURE__ */ __name(function parsePsi2(payload, psi) {
          var offset = 0;
          if (psi.payloadUnitStartIndicator) {
            offset += payload[offset] + 1;
          }
          if (psi.type === "pat") {
            parsePat2(payload.subarray(offset), psi);
          } else {
            parsePmt2(payload.subarray(offset), psi);
          }
        }, "parsePsi");
        parsePat2 = /* @__PURE__ */ __name(function parsePat3(payload, pat) {
          pat.section_number = payload[7];
          pat.last_section_number = payload[8];
          self2.pmtPid = (payload[10] & 31) << 8 | payload[11];
          pat.pmtPid = self2.pmtPid;
        }, "parsePat");
        parsePmt2 = /* @__PURE__ */ __name(function parsePmt3(payload, pmt) {
          var sectionLength, tableEnd, programInfoLength, offset;
          if (!(payload[5] & 1)) {
            return;
          }
          self2.programMapTable = {
            video: null,
            audio: null,
            "timed-metadata": {}
          };
          sectionLength = (payload[1] & 15) << 8 | payload[2];
          tableEnd = 3 + sectionLength - 4;
          programInfoLength = (payload[10] & 15) << 8 | payload[11];
          offset = 12 + programInfoLength;
          while (offset < tableEnd) {
            var streamType = payload[offset];
            var pid = (payload[offset + 1] & 31) << 8 | payload[offset + 2];
            if (streamType === streamTypes.H264_STREAM_TYPE && self2.programMapTable.video === null) {
              self2.programMapTable.video = pid;
            } else if (streamType === streamTypes.ADTS_STREAM_TYPE && self2.programMapTable.audio === null) {
              self2.programMapTable.audio = pid;
            } else if (streamType === streamTypes.METADATA_STREAM_TYPE) {
              self2.programMapTable["timed-metadata"][pid] = streamType;
            }
            offset += ((payload[offset + 3] & 15) << 8 | payload[offset + 4]) + 5;
          }
          pmt.programMapTable = self2.programMapTable;
        }, "parsePmt");
        this.push = function(packet) {
          var result = {}, offset = 4;
          result.payloadUnitStartIndicator = !!(packet[1] & 64);
          result.pid = packet[1] & 31;
          result.pid <<= 8;
          result.pid |= packet[2];
          if ((packet[3] & 48) >>> 4 > 1) {
            offset += packet[offset] + 1;
          }
          if (result.pid === 0) {
            result.type = "pat";
            parsePsi(packet.subarray(offset), result);
            this.trigger("data", result);
          } else if (result.pid === this.pmtPid) {
            result.type = "pmt";
            parsePsi(packet.subarray(offset), result);
            this.trigger("data", result);
            while (this.packetsWaitingForPmt.length) {
              this.processPes_.apply(this, this.packetsWaitingForPmt.shift());
            }
          } else if (this.programMapTable === void 0) {
            this.packetsWaitingForPmt.push([packet, offset, result]);
          } else {
            this.processPes_(packet, offset, result);
          }
        };
        this.processPes_ = function(packet, offset, result) {
          if (result.pid === this.programMapTable.video) {
            result.streamType = streamTypes.H264_STREAM_TYPE;
          } else if (result.pid === this.programMapTable.audio) {
            result.streamType = streamTypes.ADTS_STREAM_TYPE;
          } else {
            result.streamType = this.programMapTable["timed-metadata"][result.pid];
          }
          result.type = "pes";
          result.data = packet.subarray(offset);
          this.trigger("data", result);
        };
      }, "TransportParseStream");
      _TransportParseStream.prototype = new stream();
      _TransportParseStream.STREAM_TYPES = {
        h264: 27,
        adts: 15
      };
      _ElementaryStream = /* @__PURE__ */ __name(function ElementaryStream() {
        var self2 = this, segmentHadPmt = false, video = {
          data: [],
          size: 0
        }, audio = {
          data: [],
          size: 0
        }, timedMetadata = {
          data: [],
          size: 0
        }, programMapTable, parsePes = /* @__PURE__ */ __name(function parsePes2(payload, pes) {
          var ptsDtsFlags;
          var startPrefix = payload[0] << 16 | payload[1] << 8 | payload[2];
          pes.data = new Uint8Array();
          if (startPrefix !== 1) {
            return;
          }
          pes.packetLength = 6 + (payload[4] << 8 | payload[5]);
          pes.dataAlignmentIndicator = (payload[6] & 4) !== 0;
          ptsDtsFlags = payload[7];
          if (ptsDtsFlags & 192) {
            pes.pts = (payload[9] & 14) << 27 | (payload[10] & 255) << 20 | (payload[11] & 254) << 12 | (payload[12] & 255) << 5 | (payload[13] & 254) >>> 3;
            pes.pts *= 4;
            pes.pts += (payload[13] & 6) >>> 1;
            pes.dts = pes.pts;
            if (ptsDtsFlags & 64) {
              pes.dts = (payload[14] & 14) << 27 | (payload[15] & 255) << 20 | (payload[16] & 254) << 12 | (payload[17] & 255) << 5 | (payload[18] & 254) >>> 3;
              pes.dts *= 4;
              pes.dts += (payload[18] & 6) >>> 1;
            }
          }
          pes.data = payload.subarray(9 + payload[8]);
        }, "parsePes"), flushStream = /* @__PURE__ */ __name(function flushStream2(stream2, type2, forceFlush) {
          var packetData = new Uint8Array(stream2.size), event = {
            type: type2
          }, i = 0, offset = 0, packetFlushable = false, fragment;
          if (!stream2.data.length || stream2.size < 9) {
            return;
          }
          event.trackId = stream2.data[0].pid;
          for (i = 0; i < stream2.data.length; i++) {
            fragment = stream2.data[i];
            packetData.set(fragment.data, offset);
            offset += fragment.data.byteLength;
          }
          parsePes(packetData, event);
          packetFlushable = type2 === "video" || event.packetLength <= stream2.size;
          if (forceFlush || packetFlushable) {
            stream2.size = 0;
            stream2.data.length = 0;
          }
          if (packetFlushable) {
            self2.trigger("data", event);
          }
        }, "flushStream");
        _ElementaryStream.prototype.init.call(this);
        this.push = function(data) {
          ({
            pat: /* @__PURE__ */ __name(function pat() {
            }, "pat"),
            pes: /* @__PURE__ */ __name(function pes() {
              var stream2, streamType;
              switch (data.streamType) {
                case streamTypes.H264_STREAM_TYPE:
                  stream2 = video;
                  streamType = "video";
                  break;
                case streamTypes.ADTS_STREAM_TYPE:
                  stream2 = audio;
                  streamType = "audio";
                  break;
                case streamTypes.METADATA_STREAM_TYPE:
                  stream2 = timedMetadata;
                  streamType = "timed-metadata";
                  break;
                default:
                  return;
              }
              if (data.payloadUnitStartIndicator) {
                flushStream(stream2, streamType, true);
              }
              stream2.data.push(data);
              stream2.size += data.data.byteLength;
            }, "pes"),
            pmt: /* @__PURE__ */ __name(function pmt() {
              var event = {
                type: "metadata",
                tracks: []
              };
              programMapTable = data.programMapTable;
              if (programMapTable.video !== null) {
                event.tracks.push({
                  timelineStartInfo: {
                    baseMediaDecodeTime: 0
                  },
                  id: +programMapTable.video,
                  codec: "avc",
                  type: "video"
                });
              }
              if (programMapTable.audio !== null) {
                event.tracks.push({
                  timelineStartInfo: {
                    baseMediaDecodeTime: 0
                  },
                  id: +programMapTable.audio,
                  codec: "adts",
                  type: "audio"
                });
              }
              segmentHadPmt = true;
              self2.trigger("data", event);
            }, "pmt")
          })[data.type]();
        };
        this.reset = function() {
          video.size = 0;
          video.data.length = 0;
          audio.size = 0;
          audio.data.length = 0;
          this.trigger("reset");
        };
        this.flushStreams_ = function() {
          flushStream(video, "video");
          flushStream(audio, "audio");
          flushStream(timedMetadata, "timed-metadata");
        };
        this.flush = function() {
          if (!segmentHadPmt && programMapTable) {
            var pmt = {
              type: "metadata",
              tracks: []
            };
            if (programMapTable.video !== null) {
              pmt.tracks.push({
                timelineStartInfo: {
                  baseMediaDecodeTime: 0
                },
                id: +programMapTable.video,
                codec: "avc",
                type: "video"
              });
            }
            if (programMapTable.audio !== null) {
              pmt.tracks.push({
                timelineStartInfo: {
                  baseMediaDecodeTime: 0
                },
                id: +programMapTable.audio,
                codec: "adts",
                type: "audio"
              });
            }
            self2.trigger("data", pmt);
          }
          segmentHadPmt = false;
          this.flushStreams_();
          this.trigger("done");
        };
      }, "ElementaryStream");
      _ElementaryStream.prototype = new stream();
      var m2ts$1 = {
        PAT_PID: 0,
        MP2T_PACKET_LENGTH: MP2T_PACKET_LENGTH$1,
        TransportPacketStream: _TransportPacketStream,
        TransportParseStream: _TransportParseStream,
        ElementaryStream: _ElementaryStream,
        TimestampRolloverStream,
        CaptionStream: captionStream.CaptionStream,
        Cea608Stream: captionStream.Cea608Stream,
        Cea708Stream: captionStream.Cea708Stream,
        MetadataStream: metadataStream
      };
      for (var type in streamTypes) {
        if (streamTypes.hasOwnProperty(type)) {
          m2ts$1[type] = streamTypes[type];
        }
      }
      var m2ts_1 = m2ts$1;
      var ADTS_SAMPLING_FREQUENCIES = [96e3, 88200, 64e3, 48e3, 44100, 32e3, 24e3, 22050, 16e3, 12e3, 11025, 8e3, 7350];
      var parseId3TagSize = /* @__PURE__ */ __name(function parseId3TagSize2(header, byteIndex) {
        var returnSize = header[byteIndex + 6] << 21 | header[byteIndex + 7] << 14 | header[byteIndex + 8] << 7 | header[byteIndex + 9], flags = header[byteIndex + 5], footerPresent = (flags & 16) >> 4;
        returnSize = returnSize >= 0 ? returnSize : 0;
        if (footerPresent) {
          return returnSize + 20;
        }
        return returnSize + 10;
      }, "parseId3TagSize");
      var getId3Offset = /* @__PURE__ */ __name(function getId3Offset2(data, offset) {
        if (data.length - offset < 10 || data[offset] !== "I".charCodeAt(0) || data[offset + 1] !== "D".charCodeAt(0) || data[offset + 2] !== "3".charCodeAt(0)) {
          return offset;
        }
        offset += parseId3TagSize(data, offset);
        return getId3Offset2(data, offset);
      }, "getId3Offset");
      var isLikelyAacData$2 = /* @__PURE__ */ __name(function isLikelyAacData2(data) {
        var offset = getId3Offset(data, 0);
        return data.length >= offset + 2 && (data[offset] & 255) === 255 && (data[offset + 1] & 240) === 240 && // verify that the 2 layer bits are 0, aka this
        // is not mp3 data but aac data.
        (data[offset + 1] & 22) === 16;
      }, "isLikelyAacData");
      var parseSyncSafeInteger = /* @__PURE__ */ __name(function parseSyncSafeInteger2(data) {
        return data[0] << 21 | data[1] << 14 | data[2] << 7 | data[3];
      }, "parseSyncSafeInteger");
      var percentEncode = /* @__PURE__ */ __name(function percentEncode2(bytes, start, end) {
        var i, result = "";
        for (i = start; i < end; i++) {
          result += "%" + ("00" + bytes[i].toString(16)).slice(-2);
        }
        return result;
      }, "percentEncode");
      var parseIso88591 = /* @__PURE__ */ __name(function parseIso885912(bytes, start, end) {
        return unescape(percentEncode(bytes, start, end));
      }, "parseIso88591");
      var parseAdtsSize = /* @__PURE__ */ __name(function parseAdtsSize2(header, byteIndex) {
        var lowThree = (header[byteIndex + 5] & 224) >> 5, middle = header[byteIndex + 4] << 3, highTwo = header[byteIndex + 3] & 3 << 11;
        return highTwo | middle | lowThree;
      }, "parseAdtsSize");
      var parseType$1 = /* @__PURE__ */ __name(function parseType2(header, byteIndex) {
        if (header[byteIndex] === "I".charCodeAt(0) && header[byteIndex + 1] === "D".charCodeAt(0) && header[byteIndex + 2] === "3".charCodeAt(0)) {
          return "timed-metadata";
        } else if (header[byteIndex] & true && (header[byteIndex + 1] & 240) === 240) {
          return "audio";
        }
        return null;
      }, "parseType");
      var parseSampleRate = /* @__PURE__ */ __name(function parseSampleRate2(packet) {
        var i = 0;
        while (i + 5 < packet.length) {
          if (packet[i] !== 255 || (packet[i + 1] & 246) !== 240) {
            i++;
            continue;
          }
          return ADTS_SAMPLING_FREQUENCIES[(packet[i + 2] & 60) >>> 2];
        }
        return null;
      }, "parseSampleRate");
      var parseAacTimestamp = /* @__PURE__ */ __name(function parseAacTimestamp2(packet) {
        var frameStart, frameSize, frame, frameHeader;
        frameStart = 10;
        if (packet[5] & 64) {
          frameStart += 4;
          frameStart += parseSyncSafeInteger(packet.subarray(10, 14));
        }
        do {
          frameSize = parseSyncSafeInteger(packet.subarray(frameStart + 4, frameStart + 8));
          if (frameSize < 1) {
            return null;
          }
          frameHeader = String.fromCharCode(packet[frameStart], packet[frameStart + 1], packet[frameStart + 2], packet[frameStart + 3]);
          if (frameHeader === "PRIV") {
            frame = packet.subarray(frameStart + 10, frameStart + frameSize + 10);
            for (var i = 0; i < frame.byteLength; i++) {
              if (frame[i] === 0) {
                var owner = parseIso88591(frame, 0, i);
                if (owner === "com.apple.streaming.transportStreamTimestamp") {
                  var d = frame.subarray(i + 1);
                  var size = (d[3] & 1) << 30 | d[4] << 22 | d[5] << 14 | d[6] << 6 | d[7] >>> 2;
                  size *= 4;
                  size += d[7] & 3;
                  return size;
                }
                break;
              }
            }
          }
          frameStart += 10;
          frameStart += frameSize;
        } while (frameStart < packet.byteLength);
        return null;
      }, "parseAacTimestamp");
      var utils = {
        isLikelyAacData: isLikelyAacData$2,
        parseId3TagSize,
        parseAdtsSize,
        parseType: parseType$1,
        parseSampleRate,
        parseAacTimestamp
      };
      var _AacStream;
      _AacStream = /* @__PURE__ */ __name(function AacStream() {
        var everything = new Uint8Array(), timeStamp = 0;
        _AacStream.prototype.init.call(this);
        this.setTimestamp = function(timestamp) {
          timeStamp = timestamp;
        };
        this.push = function(bytes) {
          var frameSize = 0, byteIndex = 0, bytesLeft, chunk, packet, tempLength;
          if (everything.length) {
            tempLength = everything.length;
            everything = new Uint8Array(bytes.byteLength + tempLength);
            everything.set(everything.subarray(0, tempLength));
            everything.set(bytes, tempLength);
          } else {
            everything = bytes;
          }
          while (everything.length - byteIndex >= 3) {
            if (everything[byteIndex] === "I".charCodeAt(0) && everything[byteIndex + 1] === "D".charCodeAt(0) && everything[byteIndex + 2] === "3".charCodeAt(0)) {
              if (everything.length - byteIndex < 10) {
                break;
              }
              frameSize = utils.parseId3TagSize(everything, byteIndex);
              if (byteIndex + frameSize > everything.length) {
                break;
              }
              chunk = {
                type: "timed-metadata",
                data: everything.subarray(byteIndex, byteIndex + frameSize)
              };
              this.trigger("data", chunk);
              byteIndex += frameSize;
              continue;
            } else if ((everything[byteIndex] & 255) === 255 && (everything[byteIndex + 1] & 240) === 240) {
              if (everything.length - byteIndex < 7) {
                break;
              }
              frameSize = utils.parseAdtsSize(everything, byteIndex);
              if (byteIndex + frameSize > everything.length) {
                break;
              }
              packet = {
                type: "audio",
                data: everything.subarray(byteIndex, byteIndex + frameSize),
                pts: timeStamp,
                dts: timeStamp
              };
              this.trigger("data", packet);
              byteIndex += frameSize;
              continue;
            }
            byteIndex++;
          }
          bytesLeft = everything.length - byteIndex;
          if (bytesLeft > 0) {
            everything = everything.subarray(byteIndex);
          } else {
            everything = new Uint8Array();
          }
        };
        this.reset = function() {
          everything = new Uint8Array();
          this.trigger("reset");
        };
        this.endTimeline = function() {
          everything = new Uint8Array();
          this.trigger("endedtimeline");
        };
      }, "AacStream");
      _AacStream.prototype = new stream();
      var aac = _AacStream;
      var AUDIO_PROPERTIES = ["audioobjecttype", "channelcount", "samplerate", "samplingfrequencyindex", "samplesize"];
      var audioProperties = AUDIO_PROPERTIES;
      var VIDEO_PROPERTIES = ["width", "height", "profileIdc", "levelIdc", "profileCompatibility", "sarRatio"];
      var videoProperties = VIDEO_PROPERTIES;
      var H264Stream$1 = h264.H264Stream;
      var isLikelyAacData$1 = utils.isLikelyAacData;
      var ONE_SECOND_IN_TS$2 = clock.ONE_SECOND_IN_TS;
      var _VideoSegmentStream$1, _AudioSegmentStream$1, _Transmuxer$1, _CoalesceStream;
      var retriggerForStream = /* @__PURE__ */ __name(function retriggerForStream2(key, event) {
        event.stream = key;
        this.trigger("log", event);
      }, "retriggerForStream");
      var addPipelineLogRetriggers = /* @__PURE__ */ __name(function addPipelineLogRetriggers2(transmuxer2, pipeline) {
        var keys = Object.keys(pipeline);
        for (var i = 0; i < keys.length; i++) {
          var key = keys[i];
          if (key === "headOfPipeline" || !pipeline[key].on) {
            continue;
          }
          pipeline[key].on("log", retriggerForStream.bind(transmuxer2, key));
        }
      }, "addPipelineLogRetriggers");
      var arrayEquals = /* @__PURE__ */ __name(function arrayEquals2(a, b) {
        var i;
        if (a.length !== b.length) {
          return false;
        }
        for (i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) {
            return false;
          }
        }
        return true;
      }, "arrayEquals");
      var generateSegmentTimingInfo = /* @__PURE__ */ __name(function generateSegmentTimingInfo2(baseMediaDecodeTime, startDts, startPts, endDts, endPts, prependedContentDuration) {
        var ptsOffsetFromDts = startPts - startDts, decodeDuration = endDts - startDts, presentationDuration = endPts - startPts;
        return {
          start: {
            dts: baseMediaDecodeTime,
            pts: baseMediaDecodeTime + ptsOffsetFromDts
          },
          end: {
            dts: baseMediaDecodeTime + decodeDuration,
            pts: baseMediaDecodeTime + presentationDuration
          },
          prependedContentDuration,
          baseMediaDecodeTime
        };
      }, "generateSegmentTimingInfo");
      _AudioSegmentStream$1 = /* @__PURE__ */ __name(function AudioSegmentStream2(track, options) {
        var adtsFrames = [], sequenceNumber, earliestAllowedDts = 0, audioAppendStartTs = 0, videoBaseMediaDecodeTime = Infinity;
        options = options || {};
        sequenceNumber = options.firstSequenceNumber || 0;
        _AudioSegmentStream$1.prototype.init.call(this);
        this.push = function(data) {
          trackDecodeInfo.collectDtsInfo(track, data);
          if (track) {
            audioProperties.forEach(function(prop) {
              track[prop] = data[prop];
            });
          }
          adtsFrames.push(data);
        };
        this.setEarliestDts = function(earliestDts) {
          earliestAllowedDts = earliestDts;
        };
        this.setVideoBaseMediaDecodeTime = function(baseMediaDecodeTime) {
          videoBaseMediaDecodeTime = baseMediaDecodeTime;
        };
        this.setAudioAppendStart = function(timestamp) {
          audioAppendStartTs = timestamp;
        };
        this.flush = function() {
          var frames, moof2, mdat2, boxes, frameDuration, segmentDuration, videoClockCyclesOfSilencePrefixed;
          if (adtsFrames.length === 0) {
            this.trigger("done", "AudioSegmentStream");
            return;
          }
          frames = audioFrameUtils.trimAdtsFramesByEarliestDts(adtsFrames, track, earliestAllowedDts);
          track.baseMediaDecodeTime = trackDecodeInfo.calculateTrackBaseMediaDecodeTime(track, options.keepOriginalTimestamps);
          videoClockCyclesOfSilencePrefixed = audioFrameUtils.prefixWithSilence(track, frames, audioAppendStartTs, videoBaseMediaDecodeTime);
          track.samples = audioFrameUtils.generateSampleTable(frames);
          mdat2 = mp4Generator.mdat(audioFrameUtils.concatenateFrameData(frames));
          adtsFrames = [];
          moof2 = mp4Generator.moof(sequenceNumber, [track]);
          boxes = new Uint8Array(moof2.byteLength + mdat2.byteLength);
          sequenceNumber++;
          boxes.set(moof2);
          boxes.set(mdat2, moof2.byteLength);
          trackDecodeInfo.clearDtsInfo(track);
          frameDuration = Math.ceil(ONE_SECOND_IN_TS$2 * 1024 / track.samplerate);
          if (frames.length) {
            segmentDuration = frames.length * frameDuration;
            this.trigger("segmentTimingInfo", generateSegmentTimingInfo(
              // The audio track's baseMediaDecodeTime is in audio clock cycles, but the
              // frame info is in video clock cycles. Convert to match expectation of
              // listeners (that all timestamps will be based on video clock cycles).
              clock.audioTsToVideoTs(track.baseMediaDecodeTime, track.samplerate),
              // frame times are already in video clock, as is segment duration
              frames[0].dts,
              frames[0].pts,
              frames[0].dts + segmentDuration,
              frames[0].pts + segmentDuration,
              videoClockCyclesOfSilencePrefixed || 0
            ));
            this.trigger("timingInfo", {
              start: frames[0].pts,
              end: frames[0].pts + segmentDuration
            });
          }
          this.trigger("data", {
            track,
            boxes
          });
          this.trigger("done", "AudioSegmentStream");
        };
        this.reset = function() {
          trackDecodeInfo.clearDtsInfo(track);
          adtsFrames = [];
          this.trigger("reset");
        };
      }, "AudioSegmentStream");
      _AudioSegmentStream$1.prototype = new stream();
      _VideoSegmentStream$1 = /* @__PURE__ */ __name(function VideoSegmentStream2(track, options) {
        var sequenceNumber, nalUnits = [], gopsToAlignWith = [], config, pps;
        options = options || {};
        sequenceNumber = options.firstSequenceNumber || 0;
        _VideoSegmentStream$1.prototype.init.call(this);
        delete track.minPTS;
        this.gopCache_ = [];
        this.push = function(nalUnit) {
          trackDecodeInfo.collectDtsInfo(track, nalUnit);
          if (nalUnit.nalUnitType === "seq_parameter_set_rbsp" && !config) {
            config = nalUnit.config;
            track.sps = [nalUnit.data];
            videoProperties.forEach(function(prop) {
              track[prop] = config[prop];
            }, this);
          }
          if (nalUnit.nalUnitType === "pic_parameter_set_rbsp" && !pps) {
            pps = nalUnit.data;
            track.pps = [nalUnit.data];
          }
          nalUnits.push(nalUnit);
        };
        this.flush = function() {
          var frames, gopForFusion, gops, moof2, mdat2, boxes, prependedContentDuration = 0, firstGop, lastGop;
          while (nalUnits.length) {
            if (nalUnits[0].nalUnitType === "access_unit_delimiter_rbsp") {
              break;
            }
            nalUnits.shift();
          }
          if (nalUnits.length === 0) {
            this.resetStream_();
            this.trigger("done", "VideoSegmentStream");
            return;
          }
          frames = frameUtils.groupNalsIntoFrames(nalUnits);
          gops = frameUtils.groupFramesIntoGops(frames);
          if (!gops[0][0].keyFrame) {
            gopForFusion = this.getGopForFusion_(nalUnits[0], track);
            if (gopForFusion) {
              prependedContentDuration = gopForFusion.duration;
              gops.unshift(gopForFusion);
              gops.byteLength += gopForFusion.byteLength;
              gops.nalCount += gopForFusion.nalCount;
              gops.pts = gopForFusion.pts;
              gops.dts = gopForFusion.dts;
              gops.duration += gopForFusion.duration;
            } else {
              gops = frameUtils.extendFirstKeyFrame(gops);
            }
          }
          if (gopsToAlignWith.length) {
            var alignedGops;
            if (options.alignGopsAtEnd) {
              alignedGops = this.alignGopsAtEnd_(gops);
            } else {
              alignedGops = this.alignGopsAtStart_(gops);
            }
            if (!alignedGops) {
              this.gopCache_.unshift({
                gop: gops.pop(),
                pps: track.pps,
                sps: track.sps
              });
              this.gopCache_.length = Math.min(6, this.gopCache_.length);
              nalUnits = [];
              this.resetStream_();
              this.trigger("done", "VideoSegmentStream");
              return;
            }
            trackDecodeInfo.clearDtsInfo(track);
            gops = alignedGops;
          }
          trackDecodeInfo.collectDtsInfo(track, gops);
          track.samples = frameUtils.generateSampleTable(gops);
          mdat2 = mp4Generator.mdat(frameUtils.concatenateNalData(gops));
          track.baseMediaDecodeTime = trackDecodeInfo.calculateTrackBaseMediaDecodeTime(track, options.keepOriginalTimestamps);
          this.trigger("processedGopsInfo", gops.map(function(gop) {
            return {
              pts: gop.pts,
              dts: gop.dts,
              byteLength: gop.byteLength
            };
          }));
          firstGop = gops[0];
          lastGop = gops[gops.length - 1];
          this.trigger("segmentTimingInfo", generateSegmentTimingInfo(track.baseMediaDecodeTime, firstGop.dts, firstGop.pts, lastGop.dts + lastGop.duration, lastGop.pts + lastGop.duration, prependedContentDuration));
          this.trigger("timingInfo", {
            start: gops[0].pts,
            end: gops[gops.length - 1].pts + gops[gops.length - 1].duration
          });
          this.gopCache_.unshift({
            gop: gops.pop(),
            pps: track.pps,
            sps: track.sps
          });
          this.gopCache_.length = Math.min(6, this.gopCache_.length);
          nalUnits = [];
          this.trigger("baseMediaDecodeTime", track.baseMediaDecodeTime);
          this.trigger("timelineStartInfo", track.timelineStartInfo);
          moof2 = mp4Generator.moof(sequenceNumber, [track]);
          boxes = new Uint8Array(moof2.byteLength + mdat2.byteLength);
          sequenceNumber++;
          boxes.set(moof2);
          boxes.set(mdat2, moof2.byteLength);
          this.trigger("data", {
            track,
            boxes
          });
          this.resetStream_();
          this.trigger("done", "VideoSegmentStream");
        };
        this.reset = function() {
          this.resetStream_();
          nalUnits = [];
          this.gopCache_.length = 0;
          gopsToAlignWith.length = 0;
          this.trigger("reset");
        };
        this.resetStream_ = function() {
          trackDecodeInfo.clearDtsInfo(track);
          config = void 0;
          pps = void 0;
        };
        this.getGopForFusion_ = function(nalUnit) {
          var halfSecond = 45e3, allowableOverlap = 1e4, nearestDistance = Infinity, dtsDistance, nearestGopObj, currentGop, currentGopObj, i;
          for (i = 0; i < this.gopCache_.length; i++) {
            currentGopObj = this.gopCache_[i];
            currentGop = currentGopObj.gop;
            if (!(track.pps && arrayEquals(track.pps[0], currentGopObj.pps[0])) || !(track.sps && arrayEquals(track.sps[0], currentGopObj.sps[0]))) {
              continue;
            }
            if (currentGop.dts < track.timelineStartInfo.dts) {
              continue;
            }
            dtsDistance = nalUnit.dts - currentGop.dts - currentGop.duration;
            if (dtsDistance >= -allowableOverlap && dtsDistance <= halfSecond) {
              if (!nearestGopObj || nearestDistance > dtsDistance) {
                nearestGopObj = currentGopObj;
                nearestDistance = dtsDistance;
              }
            }
          }
          if (nearestGopObj) {
            return nearestGopObj.gop;
          }
          return null;
        };
        this.alignGopsAtStart_ = function(gops) {
          var alignIndex, gopIndex, align, gop, byteLength, nalCount, duration, alignedGops;
          byteLength = gops.byteLength;
          nalCount = gops.nalCount;
          duration = gops.duration;
          alignIndex = gopIndex = 0;
          while (alignIndex < gopsToAlignWith.length && gopIndex < gops.length) {
            align = gopsToAlignWith[alignIndex];
            gop = gops[gopIndex];
            if (align.pts === gop.pts) {
              break;
            }
            if (gop.pts > align.pts) {
              alignIndex++;
              continue;
            }
            gopIndex++;
            byteLength -= gop.byteLength;
            nalCount -= gop.nalCount;
            duration -= gop.duration;
          }
          if (gopIndex === 0) {
            return gops;
          }
          if (gopIndex === gops.length) {
            return null;
          }
          alignedGops = gops.slice(gopIndex);
          alignedGops.byteLength = byteLength;
          alignedGops.duration = duration;
          alignedGops.nalCount = nalCount;
          alignedGops.pts = alignedGops[0].pts;
          alignedGops.dts = alignedGops[0].dts;
          return alignedGops;
        };
        this.alignGopsAtEnd_ = function(gops) {
          var alignIndex, gopIndex, align, gop, alignEndIndex, matchFound;
          alignIndex = gopsToAlignWith.length - 1;
          gopIndex = gops.length - 1;
          alignEndIndex = null;
          matchFound = false;
          while (alignIndex >= 0 && gopIndex >= 0) {
            align = gopsToAlignWith[alignIndex];
            gop = gops[gopIndex];
            if (align.pts === gop.pts) {
              matchFound = true;
              break;
            }
            if (align.pts > gop.pts) {
              alignIndex--;
              continue;
            }
            if (alignIndex === gopsToAlignWith.length - 1) {
              alignEndIndex = gopIndex;
            }
            gopIndex--;
          }
          if (!matchFound && alignEndIndex === null) {
            return null;
          }
          var trimIndex;
          if (matchFound) {
            trimIndex = gopIndex;
          } else {
            trimIndex = alignEndIndex;
          }
          if (trimIndex === 0) {
            return gops;
          }
          var alignedGops = gops.slice(trimIndex);
          var metadata = alignedGops.reduce(function(total, gop2) {
            total.byteLength += gop2.byteLength;
            total.duration += gop2.duration;
            total.nalCount += gop2.nalCount;
            return total;
          }, {
            byteLength: 0,
            duration: 0,
            nalCount: 0
          });
          alignedGops.byteLength = metadata.byteLength;
          alignedGops.duration = metadata.duration;
          alignedGops.nalCount = metadata.nalCount;
          alignedGops.pts = alignedGops[0].pts;
          alignedGops.dts = alignedGops[0].dts;
          return alignedGops;
        };
        this.alignGopsWith = function(newGopsToAlignWith) {
          gopsToAlignWith = newGopsToAlignWith;
        };
      }, "VideoSegmentStream");
      _VideoSegmentStream$1.prototype = new stream();
      _CoalesceStream = /* @__PURE__ */ __name(function CoalesceStream2(options, metadataStream2) {
        this.numberOfTracks = 0;
        this.metadataStream = metadataStream2;
        options = options || {};
        if (typeof options.remux !== "undefined") {
          this.remuxTracks = !!options.remux;
        } else {
          this.remuxTracks = true;
        }
        if (typeof options.keepOriginalTimestamps === "boolean") {
          this.keepOriginalTimestamps = options.keepOriginalTimestamps;
        } else {
          this.keepOriginalTimestamps = false;
        }
        this.pendingTracks = [];
        this.videoTrack = null;
        this.pendingBoxes = [];
        this.pendingCaptions = [];
        this.pendingMetadata = [];
        this.pendingBytes = 0;
        this.emittedTracks = 0;
        _CoalesceStream.prototype.init.call(this);
        this.push = function(output) {
          if (output.content || output.text) {
            return this.pendingCaptions.push(output);
          }
          if (output.frames) {
            return this.pendingMetadata.push(output);
          }
          this.pendingTracks.push(output.track);
          this.pendingBytes += output.boxes.byteLength;
          if (output.track.type === "video") {
            this.videoTrack = output.track;
            this.pendingBoxes.push(output.boxes);
          }
          if (output.track.type === "audio") {
            this.audioTrack = output.track;
            this.pendingBoxes.unshift(output.boxes);
          }
        };
      }, "CoalesceStream");
      _CoalesceStream.prototype = new stream();
      _CoalesceStream.prototype.flush = function(flushSource) {
        var offset = 0, event = {
          captions: [],
          captionStreams: {},
          metadata: [],
          info: {}
        }, caption, id3, initSegment, timelineStartPts = 0, i;
        if (this.pendingTracks.length < this.numberOfTracks) {
          if (flushSource !== "VideoSegmentStream" && flushSource !== "AudioSegmentStream") {
            return;
          } else if (this.remuxTracks) {
            return;
          } else if (this.pendingTracks.length === 0) {
            this.emittedTracks++;
            if (this.emittedTracks >= this.numberOfTracks) {
              this.trigger("done");
              this.emittedTracks = 0;
            }
            return;
          }
        }
        if (this.videoTrack) {
          timelineStartPts = this.videoTrack.timelineStartInfo.pts;
          videoProperties.forEach(function(prop) {
            event.info[prop] = this.videoTrack[prop];
          }, this);
        } else if (this.audioTrack) {
          timelineStartPts = this.audioTrack.timelineStartInfo.pts;
          audioProperties.forEach(function(prop) {
            event.info[prop] = this.audioTrack[prop];
          }, this);
        }
        if (this.videoTrack || this.audioTrack) {
          if (this.pendingTracks.length === 1) {
            event.type = this.pendingTracks[0].type;
          } else {
            event.type = "combined";
          }
          this.emittedTracks += this.pendingTracks.length;
          initSegment = mp4Generator.initSegment(this.pendingTracks);
          event.initSegment = new Uint8Array(initSegment.byteLength);
          event.initSegment.set(initSegment);
          event.data = new Uint8Array(this.pendingBytes);
          for (i = 0; i < this.pendingBoxes.length; i++) {
            event.data.set(this.pendingBoxes[i], offset);
            offset += this.pendingBoxes[i].byteLength;
          }
          for (i = 0; i < this.pendingCaptions.length; i++) {
            caption = this.pendingCaptions[i];
            caption.startTime = clock.metadataTsToSeconds(caption.startPts, timelineStartPts, this.keepOriginalTimestamps);
            caption.endTime = clock.metadataTsToSeconds(caption.endPts, timelineStartPts, this.keepOriginalTimestamps);
            event.captionStreams[caption.stream] = true;
            event.captions.push(caption);
          }
          for (i = 0; i < this.pendingMetadata.length; i++) {
            id3 = this.pendingMetadata[i];
            id3.cueTime = clock.metadataTsToSeconds(id3.pts, timelineStartPts, this.keepOriginalTimestamps);
            event.metadata.push(id3);
          }
          event.metadata.dispatchType = this.metadataStream.dispatchType;
          this.pendingTracks.length = 0;
          this.videoTrack = null;
          this.pendingBoxes.length = 0;
          this.pendingCaptions.length = 0;
          this.pendingBytes = 0;
          this.pendingMetadata.length = 0;
          this.trigger("data", event);
          for (i = 0; i < event.captions.length; i++) {
            caption = event.captions[i];
            this.trigger("caption", caption);
          }
          for (i = 0; i < event.metadata.length; i++) {
            id3 = event.metadata[i];
            this.trigger("id3Frame", id3);
          }
        }
        if (this.emittedTracks >= this.numberOfTracks) {
          this.trigger("done");
          this.emittedTracks = 0;
        }
      };
      _CoalesceStream.prototype.setRemux = function(val) {
        this.remuxTracks = val;
      };
      _Transmuxer$1 = /* @__PURE__ */ __name(function Transmuxer2(options) {
        var self2 = this, hasFlushed = true, videoTrack, audioTrack;
        _Transmuxer$1.prototype.init.call(this);
        options = options || {};
        this.baseMediaDecodeTime = options.baseMediaDecodeTime || 0;
        this.transmuxPipeline_ = {};
        this.setupAacPipeline = function() {
          var pipeline = {};
          this.transmuxPipeline_ = pipeline;
          pipeline.type = "aac";
          pipeline.metadataStream = new m2ts_1.MetadataStream();
          pipeline.aacStream = new aac();
          pipeline.audioTimestampRolloverStream = new m2ts_1.TimestampRolloverStream("audio");
          pipeline.timedMetadataTimestampRolloverStream = new m2ts_1.TimestampRolloverStream("timed-metadata");
          pipeline.adtsStream = new adts();
          pipeline.coalesceStream = new _CoalesceStream(options, pipeline.metadataStream);
          pipeline.headOfPipeline = pipeline.aacStream;
          pipeline.aacStream.pipe(pipeline.audioTimestampRolloverStream).pipe(pipeline.adtsStream);
          pipeline.aacStream.pipe(pipeline.timedMetadataTimestampRolloverStream).pipe(pipeline.metadataStream).pipe(pipeline.coalesceStream);
          pipeline.metadataStream.on("timestamp", function(frame) {
            pipeline.aacStream.setTimestamp(frame.timeStamp);
          });
          pipeline.aacStream.on("data", function(data) {
            if (data.type !== "timed-metadata" && data.type !== "audio" || pipeline.audioSegmentStream) {
              return;
            }
            audioTrack = audioTrack || {
              timelineStartInfo: {
                baseMediaDecodeTime: self2.baseMediaDecodeTime
              },
              codec: "adts",
              type: "audio"
            };
            pipeline.coalesceStream.numberOfTracks++;
            pipeline.audioSegmentStream = new _AudioSegmentStream$1(audioTrack, options);
            pipeline.audioSegmentStream.on("log", self2.getLogTrigger_("audioSegmentStream"));
            pipeline.audioSegmentStream.on("timingInfo", self2.trigger.bind(self2, "audioTimingInfo"));
            pipeline.adtsStream.pipe(pipeline.audioSegmentStream).pipe(pipeline.coalesceStream);
            self2.trigger("trackinfo", {
              hasAudio: !!audioTrack,
              hasVideo: !!videoTrack
            });
          });
          pipeline.coalesceStream.on("data", this.trigger.bind(this, "data"));
          pipeline.coalesceStream.on("done", this.trigger.bind(this, "done"));
          addPipelineLogRetriggers(this, pipeline);
        };
        this.setupTsPipeline = function() {
          var pipeline = {};
          this.transmuxPipeline_ = pipeline;
          pipeline.type = "ts";
          pipeline.metadataStream = new m2ts_1.MetadataStream();
          pipeline.packetStream = new m2ts_1.TransportPacketStream();
          pipeline.parseStream = new m2ts_1.TransportParseStream();
          pipeline.elementaryStream = new m2ts_1.ElementaryStream();
          pipeline.timestampRolloverStream = new m2ts_1.TimestampRolloverStream();
          pipeline.adtsStream = new adts();
          pipeline.h264Stream = new H264Stream$1();
          pipeline.captionStream = new m2ts_1.CaptionStream(options);
          pipeline.coalesceStream = new _CoalesceStream(options, pipeline.metadataStream);
          pipeline.headOfPipeline = pipeline.packetStream;
          pipeline.packetStream.pipe(pipeline.parseStream).pipe(pipeline.elementaryStream).pipe(pipeline.timestampRolloverStream);
          pipeline.timestampRolloverStream.pipe(pipeline.h264Stream);
          pipeline.timestampRolloverStream.pipe(pipeline.adtsStream);
          pipeline.timestampRolloverStream.pipe(pipeline.metadataStream).pipe(pipeline.coalesceStream);
          pipeline.h264Stream.pipe(pipeline.captionStream).pipe(pipeline.coalesceStream);
          pipeline.elementaryStream.on("data", function(data) {
            var i;
            if (data.type === "metadata") {
              i = data.tracks.length;
              while (i--) {
                if (!videoTrack && data.tracks[i].type === "video") {
                  videoTrack = data.tracks[i];
                  videoTrack.timelineStartInfo.baseMediaDecodeTime = self2.baseMediaDecodeTime;
                } else if (!audioTrack && data.tracks[i].type === "audio") {
                  audioTrack = data.tracks[i];
                  audioTrack.timelineStartInfo.baseMediaDecodeTime = self2.baseMediaDecodeTime;
                }
              }
              if (videoTrack && !pipeline.videoSegmentStream) {
                pipeline.coalesceStream.numberOfTracks++;
                pipeline.videoSegmentStream = new _VideoSegmentStream$1(videoTrack, options);
                pipeline.videoSegmentStream.on("log", self2.getLogTrigger_("videoSegmentStream"));
                pipeline.videoSegmentStream.on("timelineStartInfo", function(timelineStartInfo) {
                  if (audioTrack && !options.keepOriginalTimestamps) {
                    audioTrack.timelineStartInfo = timelineStartInfo;
                    pipeline.audioSegmentStream.setEarliestDts(timelineStartInfo.dts - self2.baseMediaDecodeTime);
                  }
                });
                pipeline.videoSegmentStream.on("processedGopsInfo", self2.trigger.bind(self2, "gopInfo"));
                pipeline.videoSegmentStream.on("segmentTimingInfo", self2.trigger.bind(self2, "videoSegmentTimingInfo"));
                pipeline.videoSegmentStream.on("baseMediaDecodeTime", function(baseMediaDecodeTime) {
                  if (audioTrack) {
                    pipeline.audioSegmentStream.setVideoBaseMediaDecodeTime(baseMediaDecodeTime);
                  }
                });
                pipeline.videoSegmentStream.on("timingInfo", self2.trigger.bind(self2, "videoTimingInfo"));
                pipeline.h264Stream.pipe(pipeline.videoSegmentStream).pipe(pipeline.coalesceStream);
              }
              if (audioTrack && !pipeline.audioSegmentStream) {
                pipeline.coalesceStream.numberOfTracks++;
                pipeline.audioSegmentStream = new _AudioSegmentStream$1(audioTrack, options);
                pipeline.audioSegmentStream.on("log", self2.getLogTrigger_("audioSegmentStream"));
                pipeline.audioSegmentStream.on("timingInfo", self2.trigger.bind(self2, "audioTimingInfo"));
                pipeline.audioSegmentStream.on("segmentTimingInfo", self2.trigger.bind(self2, "audioSegmentTimingInfo"));
                pipeline.adtsStream.pipe(pipeline.audioSegmentStream).pipe(pipeline.coalesceStream);
              }
              self2.trigger("trackinfo", {
                hasAudio: !!audioTrack,
                hasVideo: !!videoTrack
              });
            }
          });
          pipeline.coalesceStream.on("data", this.trigger.bind(this, "data"));
          pipeline.coalesceStream.on("id3Frame", function(id3Frame) {
            id3Frame.dispatchType = pipeline.metadataStream.dispatchType;
            self2.trigger("id3Frame", id3Frame);
          });
          pipeline.coalesceStream.on("caption", this.trigger.bind(this, "caption"));
          pipeline.coalesceStream.on("done", this.trigger.bind(this, "done"));
          addPipelineLogRetriggers(this, pipeline);
        };
        this.setBaseMediaDecodeTime = function(baseMediaDecodeTime) {
          var pipeline = this.transmuxPipeline_;
          if (!options.keepOriginalTimestamps) {
            this.baseMediaDecodeTime = baseMediaDecodeTime;
          }
          if (audioTrack) {
            audioTrack.timelineStartInfo.dts = void 0;
            audioTrack.timelineStartInfo.pts = void 0;
            trackDecodeInfo.clearDtsInfo(audioTrack);
            if (pipeline.audioTimestampRolloverStream) {
              pipeline.audioTimestampRolloverStream.discontinuity();
            }
          }
          if (videoTrack) {
            if (pipeline.videoSegmentStream) {
              pipeline.videoSegmentStream.gopCache_ = [];
            }
            videoTrack.timelineStartInfo.dts = void 0;
            videoTrack.timelineStartInfo.pts = void 0;
            trackDecodeInfo.clearDtsInfo(videoTrack);
            pipeline.captionStream.reset();
          }
          if (pipeline.timestampRolloverStream) {
            pipeline.timestampRolloverStream.discontinuity();
          }
        };
        this.setAudioAppendStart = function(timestamp) {
          if (audioTrack) {
            this.transmuxPipeline_.audioSegmentStream.setAudioAppendStart(timestamp);
          }
        };
        this.setRemux = function(val) {
          var pipeline = this.transmuxPipeline_;
          options.remux = val;
          if (pipeline && pipeline.coalesceStream) {
            pipeline.coalesceStream.setRemux(val);
          }
        };
        this.alignGopsWith = function(gopsToAlignWith) {
          if (videoTrack && this.transmuxPipeline_.videoSegmentStream) {
            this.transmuxPipeline_.videoSegmentStream.alignGopsWith(gopsToAlignWith);
          }
        };
        this.getLogTrigger_ = function(key) {
          var self3 = this;
          return function(event) {
            event.stream = key;
            self3.trigger("log", event);
          };
        };
        this.push = function(data) {
          if (hasFlushed) {
            var isAac = isLikelyAacData$1(data);
            if (isAac && this.transmuxPipeline_.type !== "aac") {
              this.setupAacPipeline();
            } else if (!isAac && this.transmuxPipeline_.type !== "ts") {
              this.setupTsPipeline();
            }
            hasFlushed = false;
          }
          this.transmuxPipeline_.headOfPipeline.push(data);
        };
        this.flush = function() {
          hasFlushed = true;
          this.transmuxPipeline_.headOfPipeline.flush();
        };
        this.endTimeline = function() {
          this.transmuxPipeline_.headOfPipeline.endTimeline();
        };
        this.reset = function() {
          if (this.transmuxPipeline_.headOfPipeline) {
            this.transmuxPipeline_.headOfPipeline.reset();
          }
        };
        this.resetCaptions = function() {
          if (this.transmuxPipeline_.captionStream) {
            this.transmuxPipeline_.captionStream.reset();
          }
        };
      }, "Transmuxer");
      _Transmuxer$1.prototype = new stream();
      var transmuxer$2 = {
        Transmuxer: _Transmuxer$1,
        VideoSegmentStream: _VideoSegmentStream$1,
        AudioSegmentStream: _AudioSegmentStream$1,
        AUDIO_PROPERTIES: audioProperties,
        VIDEO_PROPERTIES: videoProperties,
        // exported for testing
        generateSegmentTimingInfo
      };
      var getUint64$1 = numbers.getUint64;
      var parseSidx = /* @__PURE__ */ __name(function parseSidx2(data) {
        var view = new DataView(data.buffer, data.byteOffset, data.byteLength), result = {
          version: data[0],
          flags: new Uint8Array(data.subarray(1, 4)),
          references: [],
          referenceId: view.getUint32(4),
          timescale: view.getUint32(8)
        }, i = 12;
        if (result.version === 0) {
          result.earliestPresentationTime = view.getUint32(i);
          result.firstOffset = view.getUint32(i + 4);
          i += 8;
        } else {
          result.earliestPresentationTime = getUint64$1(data.subarray(i));
          result.firstOffset = getUint64$1(data.subarray(i + 8));
          i += 16;
        }
        i += 2;
        var referenceCount = view.getUint16(i);
        i += 2;
        for (; referenceCount > 0; i += 12, referenceCount--) {
          result.references.push({
            referenceType: (data[i] & 128) >>> 7,
            referencedSize: view.getUint32(i) & 2147483647,
            subsegmentDuration: view.getUint32(i + 4),
            startsWithSap: !!(data[i + 8] & 128),
            sapType: (data[i + 8] & 112) >>> 4,
            sapDeltaTime: view.getUint32(i + 8) & 268435455
          });
        }
        return result;
      }, "parseSidx");
      var parseSidx_1 = parseSidx;
      var getUint64 = numbers.getUint64;
      var inspectMp4, _textifyMp, parseMp4Date = /* @__PURE__ */ __name(function parseMp4Date2(seconds) {
        return new Date(seconds * 1e3 - 20828448e5);
      }, "parseMp4Date"), nalParse = /* @__PURE__ */ __name(function nalParse2(avcStream) {
        var avcView = new DataView(avcStream.buffer, avcStream.byteOffset, avcStream.byteLength), result = [], i, length;
        for (i = 0; i + 4 < avcStream.length; i += length) {
          length = avcView.getUint32(i);
          i += 4;
          if (length <= 0) {
            result.push("<span style='color:red;'>MALFORMED DATA</span>");
            continue;
          }
          switch (avcStream[i] & 31) {
            case 1:
              result.push("slice_layer_without_partitioning_rbsp");
              break;
            case 5:
              result.push("slice_layer_without_partitioning_rbsp_idr");
              break;
            case 6:
              result.push("sei_rbsp");
              break;
            case 7:
              result.push("seq_parameter_set_rbsp");
              break;
            case 8:
              result.push("pic_parameter_set_rbsp");
              break;
            case 9:
              result.push("access_unit_delimiter_rbsp");
              break;
            default:
              result.push("UNKNOWN NAL - " + avcStream[i] & 31);
              break;
          }
        }
        return result;
      }, "nalParse"), parse = {
        // codingname, not a first-class box type. stsd entries share the
        // same format as real boxes so the parsing infrastructure can be
        // shared
        avc1: /* @__PURE__ */ __name(function avc1(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength);
          return {
            dataReferenceIndex: view.getUint16(6),
            width: view.getUint16(24),
            height: view.getUint16(26),
            horizresolution: view.getUint16(28) + view.getUint16(30) / 16,
            vertresolution: view.getUint16(32) + view.getUint16(34) / 16,
            frameCount: view.getUint16(40),
            depth: view.getUint16(74),
            config: inspectMp4(data.subarray(78, data.byteLength))
          };
        }, "avc1"),
        avcC: /* @__PURE__ */ __name(function avcC(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength), result = {
            configurationVersion: data[0],
            avcProfileIndication: data[1],
            profileCompatibility: data[2],
            avcLevelIndication: data[3],
            lengthSizeMinusOne: data[4] & 3,
            sps: [],
            pps: []
          }, numOfSequenceParameterSets = data[5] & 31, numOfPictureParameterSets, nalSize, offset, i;
          offset = 6;
          for (i = 0; i < numOfSequenceParameterSets; i++) {
            nalSize = view.getUint16(offset);
            offset += 2;
            result.sps.push(new Uint8Array(data.subarray(offset, offset + nalSize)));
            offset += nalSize;
          }
          numOfPictureParameterSets = data[offset];
          offset++;
          for (i = 0; i < numOfPictureParameterSets; i++) {
            nalSize = view.getUint16(offset);
            offset += 2;
            result.pps.push(new Uint8Array(data.subarray(offset, offset + nalSize)));
            offset += nalSize;
          }
          return result;
        }, "avcC"),
        btrt: /* @__PURE__ */ __name(function btrt(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength);
          return {
            bufferSizeDB: view.getUint32(0),
            maxBitrate: view.getUint32(4),
            avgBitrate: view.getUint32(8)
          };
        }, "btrt"),
        edts: /* @__PURE__ */ __name(function edts(data) {
          return {
            boxes: inspectMp4(data)
          };
        }, "edts"),
        elst: /* @__PURE__ */ __name(function elst(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength), result = {
            version: view.getUint8(0),
            flags: new Uint8Array(data.subarray(1, 4)),
            edits: []
          }, entryCount = view.getUint32(4), i;
          for (i = 8; entryCount; entryCount--) {
            if (result.version === 0) {
              result.edits.push({
                segmentDuration: view.getUint32(i),
                mediaTime: view.getInt32(i + 4),
                mediaRate: view.getUint16(i + 8) + view.getUint16(i + 10) / (256 * 256)
              });
              i += 12;
            } else {
              result.edits.push({
                segmentDuration: getUint64(data.subarray(i)),
                mediaTime: getUint64(data.subarray(i + 8)),
                mediaRate: view.getUint16(i + 16) + view.getUint16(i + 18) / (256 * 256)
              });
              i += 20;
            }
          }
          return result;
        }, "elst"),
        esds: /* @__PURE__ */ __name(function esds2(data) {
          return {
            version: data[0],
            flags: new Uint8Array(data.subarray(1, 4)),
            esId: data[6] << 8 | data[7],
            streamPriority: data[8] & 31,
            decoderConfig: {
              objectProfileIndication: data[11],
              streamType: data[12] >>> 2 & 63,
              bufferSize: data[13] << 16 | data[14] << 8 | data[15],
              maxBitrate: data[16] << 24 | data[17] << 16 | data[18] << 8 | data[19],
              avgBitrate: data[20] << 24 | data[21] << 16 | data[22] << 8 | data[23],
              decoderConfigDescriptor: {
                tag: data[24],
                length: data[25],
                audioObjectType: data[26] >>> 3 & 31,
                samplingFrequencyIndex: (data[26] & 7) << 1 | data[27] >>> 7 & 1,
                channelConfiguration: data[27] >>> 3 & 15
              }
            }
          };
        }, "esds"),
        ftyp: /* @__PURE__ */ __name(function ftyp2(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength), result = {
            majorBrand: parseType_1(data.subarray(0, 4)),
            minorVersion: view.getUint32(4),
            compatibleBrands: []
          }, i = 8;
          while (i < data.byteLength) {
            result.compatibleBrands.push(parseType_1(data.subarray(i, i + 4)));
            i += 4;
          }
          return result;
        }, "ftyp"),
        dinf: /* @__PURE__ */ __name(function dinf2(data) {
          return {
            boxes: inspectMp4(data)
          };
        }, "dinf"),
        dref: /* @__PURE__ */ __name(function dref(data) {
          return {
            version: data[0],
            flags: new Uint8Array(data.subarray(1, 4)),
            dataReferences: inspectMp4(data.subarray(8))
          };
        }, "dref"),
        hdlr: /* @__PURE__ */ __name(function hdlr2(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength), result = {
            version: view.getUint8(0),
            flags: new Uint8Array(data.subarray(1, 4)),
            handlerType: parseType_1(data.subarray(8, 12)),
            name: ""
          }, i = 8;
          for (i = 24; i < data.byteLength; i++) {
            if (data[i] === 0) {
              i++;
              break;
            }
            result.name += String.fromCharCode(data[i]);
          }
          result.name = decodeURIComponent(escape(result.name));
          return result;
        }, "hdlr"),
        mdat: /* @__PURE__ */ __name(function mdat2(data) {
          return {
            byteLength: data.byteLength,
            nals: nalParse(data)
          };
        }, "mdat"),
        mdhd: /* @__PURE__ */ __name(function mdhd2(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength), i = 4, language, result = {
            version: view.getUint8(0),
            flags: new Uint8Array(data.subarray(1, 4)),
            language: ""
          };
          if (result.version === 1) {
            i += 4;
            result.creationTime = parseMp4Date(view.getUint32(i));
            i += 8;
            result.modificationTime = parseMp4Date(view.getUint32(i));
            i += 4;
            result.timescale = view.getUint32(i);
            i += 8;
            result.duration = view.getUint32(i);
          } else {
            result.creationTime = parseMp4Date(view.getUint32(i));
            i += 4;
            result.modificationTime = parseMp4Date(view.getUint32(i));
            i += 4;
            result.timescale = view.getUint32(i);
            i += 4;
            result.duration = view.getUint32(i);
          }
          i += 4;
          language = view.getUint16(i);
          result.language += String.fromCharCode((language >> 10) + 96);
          result.language += String.fromCharCode(((language & 992) >> 5) + 96);
          result.language += String.fromCharCode((language & 31) + 96);
          return result;
        }, "mdhd"),
        mdia: /* @__PURE__ */ __name(function mdia2(data) {
          return {
            boxes: inspectMp4(data)
          };
        }, "mdia"),
        mfhd: /* @__PURE__ */ __name(function mfhd2(data) {
          return {
            version: data[0],
            flags: new Uint8Array(data.subarray(1, 4)),
            sequenceNumber: data[4] << 24 | data[5] << 16 | data[6] << 8 | data[7]
          };
        }, "mfhd"),
        minf: /* @__PURE__ */ __name(function minf2(data) {
          return {
            boxes: inspectMp4(data)
          };
        }, "minf"),
        // codingname, not a first-class box type. stsd entries share the
        // same format as real boxes so the parsing infrastructure can be
        // shared
        mp4a: /* @__PURE__ */ __name(function mp4a(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength), result = {
            // 6 bytes reserved
            dataReferenceIndex: view.getUint16(6),
            // 4 + 4 bytes reserved
            channelcount: view.getUint16(16),
            samplesize: view.getUint16(18),
            // 2 bytes pre_defined
            // 2 bytes reserved
            samplerate: view.getUint16(24) + view.getUint16(26) / 65536
          };
          if (data.byteLength > 28) {
            result.streamDescriptor = inspectMp4(data.subarray(28))[0];
          }
          return result;
        }, "mp4a"),
        moof: /* @__PURE__ */ __name(function moof2(data) {
          return {
            boxes: inspectMp4(data)
          };
        }, "moof"),
        moov: /* @__PURE__ */ __name(function moov2(data) {
          return {
            boxes: inspectMp4(data)
          };
        }, "moov"),
        mvex: /* @__PURE__ */ __name(function mvex2(data) {
          return {
            boxes: inspectMp4(data)
          };
        }, "mvex"),
        mvhd: /* @__PURE__ */ __name(function mvhd2(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength), i = 4, result = {
            version: view.getUint8(0),
            flags: new Uint8Array(data.subarray(1, 4))
          };
          if (result.version === 1) {
            i += 4;
            result.creationTime = parseMp4Date(view.getUint32(i));
            i += 8;
            result.modificationTime = parseMp4Date(view.getUint32(i));
            i += 4;
            result.timescale = view.getUint32(i);
            i += 8;
            result.duration = view.getUint32(i);
          } else {
            result.creationTime = parseMp4Date(view.getUint32(i));
            i += 4;
            result.modificationTime = parseMp4Date(view.getUint32(i));
            i += 4;
            result.timescale = view.getUint32(i);
            i += 4;
            result.duration = view.getUint32(i);
          }
          i += 4;
          result.rate = view.getUint16(i) + view.getUint16(i + 2) / 16;
          i += 4;
          result.volume = view.getUint8(i) + view.getUint8(i + 1) / 8;
          i += 2;
          i += 2;
          i += 2 * 4;
          result.matrix = new Uint32Array(data.subarray(i, i + 9 * 4));
          i += 9 * 4;
          i += 6 * 4;
          result.nextTrackId = view.getUint32(i);
          return result;
        }, "mvhd"),
        pdin: /* @__PURE__ */ __name(function pdin(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength);
          return {
            version: view.getUint8(0),
            flags: new Uint8Array(data.subarray(1, 4)),
            rate: view.getUint32(4),
            initialDelay: view.getUint32(8)
          };
        }, "pdin"),
        sdtp: /* @__PURE__ */ __name(function sdtp2(data) {
          var result = {
            version: data[0],
            flags: new Uint8Array(data.subarray(1, 4)),
            samples: []
          }, i;
          for (i = 4; i < data.byteLength; i++) {
            result.samples.push({
              dependsOn: (data[i] & 48) >> 4,
              isDependedOn: (data[i] & 12) >> 2,
              hasRedundancy: data[i] & 3
            });
          }
          return result;
        }, "sdtp"),
        sidx: parseSidx_1,
        smhd: /* @__PURE__ */ __name(function smhd(data) {
          return {
            version: data[0],
            flags: new Uint8Array(data.subarray(1, 4)),
            balance: data[4] + data[5] / 256
          };
        }, "smhd"),
        stbl: /* @__PURE__ */ __name(function stbl2(data) {
          return {
            boxes: inspectMp4(data)
          };
        }, "stbl"),
        ctts: /* @__PURE__ */ __name(function ctts(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength), result = {
            version: view.getUint8(0),
            flags: new Uint8Array(data.subarray(1, 4)),
            compositionOffsets: []
          }, entryCount = view.getUint32(4), i;
          for (i = 8; entryCount; i += 8, entryCount--) {
            result.compositionOffsets.push({
              sampleCount: view.getUint32(i),
              sampleOffset: view[result.version === 0 ? "getUint32" : "getInt32"](i + 4)
            });
          }
          return result;
        }, "ctts"),
        stss: /* @__PURE__ */ __name(function stss(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength), result = {
            version: view.getUint8(0),
            flags: new Uint8Array(data.subarray(1, 4)),
            syncSamples: []
          }, entryCount = view.getUint32(4), i;
          for (i = 8; entryCount; i += 4, entryCount--) {
            result.syncSamples.push(view.getUint32(i));
          }
          return result;
        }, "stss"),
        stco: /* @__PURE__ */ __name(function stco(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength), result = {
            version: data[0],
            flags: new Uint8Array(data.subarray(1, 4)),
            chunkOffsets: []
          }, entryCount = view.getUint32(4), i;
          for (i = 8; entryCount; i += 4, entryCount--) {
            result.chunkOffsets.push(view.getUint32(i));
          }
          return result;
        }, "stco"),
        stsc: /* @__PURE__ */ __name(function stsc(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength), entryCount = view.getUint32(4), result = {
            version: data[0],
            flags: new Uint8Array(data.subarray(1, 4)),
            sampleToChunks: []
          }, i;
          for (i = 8; entryCount; i += 12, entryCount--) {
            result.sampleToChunks.push({
              firstChunk: view.getUint32(i),
              samplesPerChunk: view.getUint32(i + 4),
              sampleDescriptionIndex: view.getUint32(i + 8)
            });
          }
          return result;
        }, "stsc"),
        stsd: /* @__PURE__ */ __name(function stsd2(data) {
          return {
            version: data[0],
            flags: new Uint8Array(data.subarray(1, 4)),
            sampleDescriptions: inspectMp4(data.subarray(8))
          };
        }, "stsd"),
        stsz: /* @__PURE__ */ __name(function stsz(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength), result = {
            version: data[0],
            flags: new Uint8Array(data.subarray(1, 4)),
            sampleSize: view.getUint32(4),
            entries: []
          }, i;
          for (i = 12; i < data.byteLength; i += 4) {
            result.entries.push(view.getUint32(i));
          }
          return result;
        }, "stsz"),
        stts: /* @__PURE__ */ __name(function stts(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength), result = {
            version: data[0],
            flags: new Uint8Array(data.subarray(1, 4)),
            timeToSamples: []
          }, entryCount = view.getUint32(4), i;
          for (i = 8; entryCount; i += 8, entryCount--) {
            result.timeToSamples.push({
              sampleCount: view.getUint32(i),
              sampleDelta: view.getUint32(i + 4)
            });
          }
          return result;
        }, "stts"),
        styp: /* @__PURE__ */ __name(function styp(data) {
          return parse.ftyp(data);
        }, "styp"),
        tfdt: parseTfdt$1,
        tfhd: parseTfhd,
        tkhd: /* @__PURE__ */ __name(function tkhd2(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength), i = 4, result = {
            version: view.getUint8(0),
            flags: new Uint8Array(data.subarray(1, 4))
          };
          if (result.version === 1) {
            i += 4;
            result.creationTime = parseMp4Date(view.getUint32(i));
            i += 8;
            result.modificationTime = parseMp4Date(view.getUint32(i));
            i += 4;
            result.trackId = view.getUint32(i);
            i += 4;
            i += 8;
            result.duration = view.getUint32(i);
          } else {
            result.creationTime = parseMp4Date(view.getUint32(i));
            i += 4;
            result.modificationTime = parseMp4Date(view.getUint32(i));
            i += 4;
            result.trackId = view.getUint32(i);
            i += 4;
            i += 4;
            result.duration = view.getUint32(i);
          }
          i += 4;
          i += 2 * 4;
          result.layer = view.getUint16(i);
          i += 2;
          result.alternateGroup = view.getUint16(i);
          i += 2;
          result.volume = view.getUint8(i) + view.getUint8(i + 1) / 8;
          i += 2;
          i += 2;
          result.matrix = new Uint32Array(data.subarray(i, i + 9 * 4));
          i += 9 * 4;
          result.width = view.getUint16(i) + view.getUint16(i + 2) / 65536;
          i += 4;
          result.height = view.getUint16(i) + view.getUint16(i + 2) / 65536;
          return result;
        }, "tkhd"),
        traf: /* @__PURE__ */ __name(function traf2(data) {
          return {
            boxes: inspectMp4(data)
          };
        }, "traf"),
        trak: /* @__PURE__ */ __name(function trak2(data) {
          return {
            boxes: inspectMp4(data)
          };
        }, "trak"),
        trex: /* @__PURE__ */ __name(function trex2(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength);
          return {
            version: data[0],
            flags: new Uint8Array(data.subarray(1, 4)),
            trackId: view.getUint32(4),
            defaultSampleDescriptionIndex: view.getUint32(8),
            defaultSampleDuration: view.getUint32(12),
            defaultSampleSize: view.getUint32(16),
            sampleDependsOn: data[20] & 3,
            sampleIsDependedOn: (data[21] & 192) >> 6,
            sampleHasRedundancy: (data[21] & 48) >> 4,
            samplePaddingValue: (data[21] & 14) >> 1,
            sampleIsDifferenceSample: !!(data[21] & 1),
            sampleDegradationPriority: view.getUint16(22)
          };
        }, "trex"),
        trun: parseTrun$1,
        "url ": /* @__PURE__ */ __name(function url(data) {
          return {
            version: data[0],
            flags: new Uint8Array(data.subarray(1, 4))
          };
        }, "url"),
        vmhd: /* @__PURE__ */ __name(function vmhd(data) {
          var view = new DataView(data.buffer, data.byteOffset, data.byteLength);
          return {
            version: data[0],
            flags: new Uint8Array(data.subarray(1, 4)),
            graphicsmode: view.getUint16(4),
            opcolor: new Uint16Array([view.getUint16(6), view.getUint16(8), view.getUint16(10)])
          };
        }, "vmhd")
      };
      inspectMp4 = /* @__PURE__ */ __name(function inspectMp42(data) {
        var i = 0, result = [], view, size, type2, end, box2;
        var ab = new ArrayBuffer(data.length);
        var v = new Uint8Array(ab);
        for (var z = 0; z < data.length; ++z) {
          v[z] = data[z];
        }
        view = new DataView(ab);
        while (i < data.byteLength) {
          size = view.getUint32(i);
          type2 = parseType_1(data.subarray(i + 4, i + 8));
          end = size > 1 ? i + size : data.byteLength;
          box2 = (parse[type2] || function(data2) {
            return {
              data: data2
            };
          })(data.subarray(i + 8, end));
          box2.size = size;
          box2.type = type2;
          result.push(box2);
          i = end;
        }
        return result;
      }, "inspectMp4");
      _textifyMp = /* @__PURE__ */ __name(function textifyMp4(inspectedMp4, depth) {
        var indent;
        depth = depth || 0;
        indent = new Array(depth * 2 + 1).join(" ");
        return inspectedMp4.map(function(box2, index) {
          return indent + box2.type + "\n" + // the type is already included and handle child boxes separately
          Object.keys(box2).filter(function(key) {
            return key !== "type" && key !== "boxes";
          }).map(function(key) {
            var prefix = indent + "  " + key + ": ", value = box2[key];
            if (value instanceof Uint8Array || value instanceof Uint32Array) {
              var bytes = Array.prototype.slice.call(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).map(function(byte) {
                return " " + ("00" + byte.toString(16)).slice(-2);
              }).join("").match(/.{1,24}/g);
              if (!bytes) {
                return prefix + "<>";
              }
              if (bytes.length === 1) {
                return prefix + "<" + bytes.join("").slice(1) + ">";
              }
              return prefix + "<\n" + bytes.map(function(line) {
                return indent + "  " + line;
              }).join("\n") + "\n" + indent + "  >";
            }
            return prefix + JSON.stringify(value, null, 2).split("\n").map(function(line, index2) {
              if (index2 === 0) {
                return line;
              }
              return indent + "  " + line;
            }).join("\n");
          }).join("\n") + // recursively textify the child boxes
          (box2.boxes ? "\n" + _textifyMp(box2.boxes, depth + 1) : "");
        }).join("\n");
      }, "textifyMp4");
      var mp4Inspector = {
        inspect: inspectMp4,
        textify: _textifyMp,
        parseType: parseType_1,
        findBox: findBox_1,
        parseTraf: parse.traf,
        parseTfdt: parse.tfdt,
        parseHdlr: parse.hdlr,
        parseTfhd: parse.tfhd,
        parseTrun: parse.trun,
        parseSidx: parse.sidx
      };
      var parseTrun = mp4Inspector.parseTrun;
      var findBox = probe$2.findBox;
      var getMdatTrafPairs$2 = /* @__PURE__ */ __name(function getMdatTrafPairs2(segment) {
        var trafs = findBox(segment, ["moof", "traf"]);
        var mdats = findBox(segment, ["mdat"]);
        var mdatTrafPairs = [];
        mdats.forEach(function(mdat2, index) {
          var matchingTraf = trafs[index];
          mdatTrafPairs.push({
            mdat: mdat2,
            traf: matchingTraf
          });
        });
        return mdatTrafPairs;
      }, "getMdatTrafPairs");
      var parseSamples$2 = /* @__PURE__ */ __name(function parseSamples2(truns, baseMediaDecodeTime, tfhd2) {
        var currentDts = baseMediaDecodeTime;
        var defaultSampleDuration = tfhd2.defaultSampleDuration || 0;
        var defaultSampleSize = tfhd2.defaultSampleSize || 0;
        var trackId = tfhd2.trackId;
        var allSamples = [];
        truns.forEach(function(trun2) {
          var trackRun = parseTrun(trun2);
          var samples2 = trackRun.samples;
          samples2.forEach(function(sample) {
            if (sample.duration === void 0) {
              sample.duration = defaultSampleDuration;
            }
            if (sample.size === void 0) {
              sample.size = defaultSampleSize;
            }
            sample.trackId = trackId;
            sample.dts = currentDts;
            if (sample.compositionTimeOffset === void 0) {
              sample.compositionTimeOffset = 0;
            }
            if (typeof currentDts === "bigint") {
              sample.pts = currentDts + window__default["default"].BigInt(sample.compositionTimeOffset);
              currentDts += window__default["default"].BigInt(sample.duration);
            } else {
              sample.pts = currentDts + sample.compositionTimeOffset;
              currentDts += sample.duration;
            }
          });
          allSamples = allSamples.concat(samples2);
        });
        return allSamples;
      }, "parseSamples");
      var samples = {
        getMdatTrafPairs: getMdatTrafPairs$2,
        parseSamples: parseSamples$2
      };
      var discardEmulationPreventionBytes = captionPacketParser.discardEmulationPreventionBytes;
      var CaptionStream = captionStream.CaptionStream;
      var getMdatTrafPairs$1 = samples.getMdatTrafPairs, parseSamples$1 = samples.parseSamples;
      var mapToSample = /* @__PURE__ */ __name(function mapToSample2(offset, samples2) {
        var approximateOffset = offset;
        for (var i = 0; i < samples2.length; i++) {
          var sample = samples2[i];
          if (approximateOffset < sample.size) {
            return sample;
          }
          approximateOffset -= sample.size;
        }
        return null;
      }, "mapToSample");
      var findSeiNals = /* @__PURE__ */ __name(function findSeiNals2(avcStream, samples2, trackId) {
        var avcView = new DataView(avcStream.buffer, avcStream.byteOffset, avcStream.byteLength), result = {
          logs: [],
          seiNals: []
        }, seiNal, i, length, lastMatchedSample;
        for (i = 0; i + 4 < avcStream.length; i += length) {
          length = avcView.getUint32(i);
          i += 4;
          if (length <= 0) {
            continue;
          }
          switch (avcStream[i] & 31) {
            case 6:
              var data = avcStream.subarray(i + 1, i + 1 + length);
              var matchingSample = mapToSample(i, samples2);
              seiNal = {
                nalUnitType: "sei_rbsp",
                size: length,
                data,
                escapedRBSP: discardEmulationPreventionBytes(data),
                trackId
              };
              if (matchingSample) {
                seiNal.pts = matchingSample.pts;
                seiNal.dts = matchingSample.dts;
                lastMatchedSample = matchingSample;
              } else if (lastMatchedSample) {
                seiNal.pts = lastMatchedSample.pts;
                seiNal.dts = lastMatchedSample.dts;
              } else {
                result.logs.push({
                  level: "warn",
                  message: "We've encountered a nal unit without data at " + i + " for trackId " + trackId + ". See mux.js#223."
                });
                break;
              }
              result.seiNals.push(seiNal);
              break;
          }
        }
        return result;
      }, "findSeiNals");
      var parseCaptionNals = /* @__PURE__ */ __name(function parseCaptionNals2(segment, videoTrackId) {
        var captionNals = {};
        var mdatTrafPairs = getMdatTrafPairs$1(segment);
        mdatTrafPairs.forEach(function(pair) {
          var mdat2 = pair.mdat;
          var traf2 = pair.traf;
          var tfhd2 = findBox_1(traf2, ["tfhd"]);
          var headerInfo = parseTfhd(tfhd2[0]);
          var trackId = headerInfo.trackId;
          var tfdt2 = findBox_1(traf2, ["tfdt"]);
          var baseMediaDecodeTime = tfdt2.length > 0 ? parseTfdt$1(tfdt2[0]).baseMediaDecodeTime : 0;
          var truns = findBox_1(traf2, ["trun"]);
          var samples2;
          var result;
          if (videoTrackId === trackId && truns.length > 0) {
            samples2 = parseSamples$1(truns, baseMediaDecodeTime, headerInfo);
            result = findSeiNals(mdat2, samples2, trackId);
            if (!captionNals[trackId]) {
              captionNals[trackId] = {
                seiNals: [],
                logs: []
              };
            }
            captionNals[trackId].seiNals = captionNals[trackId].seiNals.concat(result.seiNals);
            captionNals[trackId].logs = captionNals[trackId].logs.concat(result.logs);
          }
        });
        return captionNals;
      }, "parseCaptionNals");
      var parseEmbeddedCaptions = /* @__PURE__ */ __name(function parseEmbeddedCaptions2(segment, trackId, timescale2) {
        var captionNals;
        if (trackId === null) {
          return null;
        }
        captionNals = parseCaptionNals(segment, trackId);
        var trackNals = captionNals[trackId] || {};
        return {
          seiNals: trackNals.seiNals,
          logs: trackNals.logs,
          timescale: timescale2
        };
      }, "parseEmbeddedCaptions");
      var CaptionParser = /* @__PURE__ */ __name(function CaptionParser2() {
        var isInitialized = false;
        var captionStream2;
        var segmentCache;
        var trackId;
        var timescale2;
        var parsedCaptions;
        var parsingPartial;
        this.isInitialized = function() {
          return isInitialized;
        };
        this.init = function(options) {
          captionStream2 = new CaptionStream();
          isInitialized = true;
          parsingPartial = options ? options.isPartial : false;
          captionStream2.on("data", function(event) {
            event.startTime = event.startPts / timescale2;
            event.endTime = event.endPts / timescale2;
            parsedCaptions.captions.push(event);
            parsedCaptions.captionStreams[event.stream] = true;
          });
          captionStream2.on("log", function(log) {
            parsedCaptions.logs.push(log);
          });
        };
        this.isNewInit = function(videoTrackIds, timescales) {
          if (videoTrackIds && videoTrackIds.length === 0 || timescales && typeof timescales === "object" && Object.keys(timescales).length === 0) {
            return false;
          }
          return trackId !== videoTrackIds[0] || timescale2 !== timescales[trackId];
        };
        this.parse = function(segment, videoTrackIds, timescales) {
          var parsedData;
          if (!this.isInitialized()) {
            return null;
          } else if (!videoTrackIds || !timescales) {
            return null;
          } else if (this.isNewInit(videoTrackIds, timescales)) {
            trackId = videoTrackIds[0];
            timescale2 = timescales[trackId];
          } else if (trackId === null || !timescale2) {
            segmentCache.push(segment);
            return null;
          }
          while (segmentCache.length > 0) {
            var cachedSegment = segmentCache.shift();
            this.parse(cachedSegment, videoTrackIds, timescales);
          }
          parsedData = parseEmbeddedCaptions(segment, trackId, timescale2);
          if (parsedData && parsedData.logs) {
            parsedCaptions.logs = parsedCaptions.logs.concat(parsedData.logs);
          }
          if (parsedData === null || !parsedData.seiNals) {
            if (parsedCaptions.logs.length) {
              return {
                logs: parsedCaptions.logs,
                captions: [],
                captionStreams: []
              };
            }
            return null;
          }
          this.pushNals(parsedData.seiNals);
          this.flushStream();
          return parsedCaptions;
        };
        this.pushNals = function(nals) {
          if (!this.isInitialized() || !nals || nals.length === 0) {
            return null;
          }
          nals.forEach(function(nal) {
            captionStream2.push(nal);
          });
        };
        this.flushStream = function() {
          if (!this.isInitialized()) {
            return null;
          }
          if (!parsingPartial) {
            captionStream2.flush();
          } else {
            captionStream2.partialFlush();
          }
        };
        this.clearParsedCaptions = function() {
          parsedCaptions.captions = [];
          parsedCaptions.captionStreams = {};
          parsedCaptions.logs = [];
        };
        this.resetCaptionStream = function() {
          if (!this.isInitialized()) {
            return null;
          }
          captionStream2.reset();
        };
        this.clearAllCaptions = function() {
          this.clearParsedCaptions();
          this.resetCaptionStream();
        };
        this.reset = function() {
          segmentCache = [];
          trackId = null;
          timescale2 = null;
          if (!parsedCaptions) {
            parsedCaptions = {
              captions: [],
              // CC1, CC2, CC3, CC4
              captionStreams: {},
              logs: []
            };
          } else {
            this.clearParsedCaptions();
          }
          this.resetCaptionStream();
        };
        this.reset();
      }, "CaptionParser");
      var captionParser = CaptionParser;
      var parseTfdt = mp4Inspector.parseTfdt;
      var getTimescaleFromMediaHeader = probe$2.getTimescaleFromMediaHeader;
      var parseSamples = samples.parseSamples, getMdatTrafPairs = samples.getMdatTrafPairs;
      var WebVttParser = /* @__PURE__ */ __name(function WebVttParser2() {
        var timescale2 = 9e4;
        this.init = function(segment) {
          var mdhd2 = findBox_1(segment, ["moov", "trak", "mdia", "mdhd"])[0];
          if (mdhd2) {
            timescale2 = getTimescaleFromMediaHeader(mdhd2);
          }
        };
        this.parseSegment = function(segment) {
          var vttCues = [];
          var mdatTrafPairs = getMdatTrafPairs(segment);
          var baseMediaDecodeTime = 0;
          mdatTrafPairs.forEach(function(pair) {
            var mdatBox = pair.mdat;
            var trafBox = pair.traf;
            var tfdtBox = findBox_1(trafBox, ["tfdt"])[0];
            var tfhdBox = findBox_1(trafBox, ["tfhd"])[0];
            var trunBoxes = findBox_1(trafBox, ["trun"]);
            if (tfdtBox) {
              var tfdt2 = parseTfdt(tfdtBox);
              baseMediaDecodeTime = tfdt2.baseMediaDecodeTime;
            }
            if (trunBoxes.length && tfhdBox) {
              var samples2 = parseSamples(trunBoxes, baseMediaDecodeTime, tfhdBox);
              var mdatOffset = 0;
              samples2.forEach(function(sample) {
                var UTF_8 = "utf-8";
                var textDecoder = new TextDecoder(UTF_8);
                var sampleData = mdatBox.slice(mdatOffset, mdatOffset + sample.size);
                var vtteBox = findBox_1(sampleData, ["vtte"])[0];
                if (vtteBox) {
                  mdatOffset += sample.size;
                  return;
                }
                var vttcBoxes = findBox_1(sampleData, ["vttc"]);
                vttcBoxes.forEach(function(vttcBox) {
                  var paylBox = findBox_1(vttcBox, ["payl"])[0];
                  var sttgBox = findBox_1(vttcBox, ["sttg"])[0];
                  var start = sample.pts / timescale2;
                  var end = (sample.pts + sample.duration) / timescale2;
                  var cueText, settings;
                  if (paylBox) {
                    try {
                      cueText = textDecoder.decode(paylBox);
                    } catch (e) {
                      console.error(e);
                    }
                  }
                  if (sttgBox) {
                    try {
                      settings = textDecoder.decode(sttgBox);
                    } catch (e) {
                      console.error(e);
                    }
                  }
                  if (sample.duration && cueText) {
                    vttCues.push({
                      cueText,
                      start,
                      end,
                      settings
                    });
                  }
                });
                mdatOffset += sample.size;
              });
            }
          });
          return vttCues;
        };
      }, "WebVttParser");
      var webvttParser = WebVttParser;
      var mp4 = {
        generator: mp4Generator,
        probe: probe$2,
        Transmuxer: transmuxer$2.Transmuxer,
        AudioSegmentStream: transmuxer$2.AudioSegmentStream,
        VideoSegmentStream: transmuxer$2.VideoSegmentStream,
        CaptionParser: captionParser,
        WebVttParser: webvttParser
      };
      var _FlvTag;
      _FlvTag = /* @__PURE__ */ __name(function FlvTag(type2, extraData) {
        var adHoc = 0, bufferStartSize = 16384, prepareWrite = /* @__PURE__ */ __name(function prepareWrite2(flv2, count) {
          var bytes, minLength = flv2.position + count;
          if (minLength < flv2.bytes.byteLength) {
            return;
          }
          bytes = new Uint8Array(minLength * 2);
          bytes.set(flv2.bytes.subarray(0, flv2.position), 0);
          flv2.bytes = bytes;
          flv2.view = new DataView(flv2.bytes.buffer);
        }, "prepareWrite"), widthBytes = _FlvTag.widthBytes || new Uint8Array("width".length), heightBytes = _FlvTag.heightBytes || new Uint8Array("height".length), videocodecidBytes = _FlvTag.videocodecidBytes || new Uint8Array("videocodecid".length), i;
        if (!_FlvTag.widthBytes) {
          for (i = 0; i < "width".length; i++) {
            widthBytes[i] = "width".charCodeAt(i);
          }
          for (i = 0; i < "height".length; i++) {
            heightBytes[i] = "height".charCodeAt(i);
          }
          for (i = 0; i < "videocodecid".length; i++) {
            videocodecidBytes[i] = "videocodecid".charCodeAt(i);
          }
          _FlvTag.widthBytes = widthBytes;
          _FlvTag.heightBytes = heightBytes;
          _FlvTag.videocodecidBytes = videocodecidBytes;
        }
        this.keyFrame = false;
        switch (type2) {
          case _FlvTag.VIDEO_TAG:
            this.length = 16;
            bufferStartSize *= 6;
            break;
          case _FlvTag.AUDIO_TAG:
            this.length = 13;
            this.keyFrame = true;
            break;
          case _FlvTag.METADATA_TAG:
            this.length = 29;
            this.keyFrame = true;
            break;
          default:
            throw new Error("Unknown FLV tag type");
        }
        this.bytes = new Uint8Array(bufferStartSize);
        this.view = new DataView(this.bytes.buffer);
        this.bytes[0] = type2;
        this.position = this.length;
        this.keyFrame = extraData;
        this.pts = 0;
        this.dts = 0;
        this.writeBytes = function(bytes, offset, length) {
          var start = offset || 0, end;
          length = length || bytes.byteLength;
          end = start + length;
          prepareWrite(this, length);
          this.bytes.set(bytes.subarray(start, end), this.position);
          this.position += length;
          this.length = Math.max(this.length, this.position);
        };
        this.writeByte = function(byte) {
          prepareWrite(this, 1);
          this.bytes[this.position] = byte;
          this.position++;
          this.length = Math.max(this.length, this.position);
        };
        this.writeShort = function(short) {
          prepareWrite(this, 2);
          this.view.setUint16(this.position, short);
          this.position += 2;
          this.length = Math.max(this.length, this.position);
        };
        this.negIndex = function(pos) {
          return this.bytes[this.length - pos];
        };
        this.nalUnitSize = function() {
          if (adHoc === 0) {
            return 0;
          }
          return this.length - (adHoc + 4);
        };
        this.startNalUnit = function() {
          if (adHoc > 0) {
            throw new Error("Attempted to create new NAL wihout closing the old one");
          }
          adHoc = this.length;
          this.length += 4;
          this.position = this.length;
        };
        this.endNalUnit = function(nalContainer) {
          var nalStart, nalLength;
          if (this.length === adHoc + 4) {
            this.length -= 4;
          } else if (adHoc > 0) {
            nalStart = adHoc + 4;
            nalLength = this.length - nalStart;
            this.position = adHoc;
            this.view.setUint32(this.position, nalLength);
            this.position = this.length;
            if (nalContainer) {
              nalContainer.push(this.bytes.subarray(nalStart, nalStart + nalLength));
            }
          }
          adHoc = 0;
        };
        this.writeMetaDataDouble = function(key, val) {
          var i2;
          prepareWrite(this, 2 + key.length + 9);
          this.view.setUint16(this.position, key.length);
          this.position += 2;
          if (key === "width") {
            this.bytes.set(widthBytes, this.position);
            this.position += 5;
          } else if (key === "height") {
            this.bytes.set(heightBytes, this.position);
            this.position += 6;
          } else if (key === "videocodecid") {
            this.bytes.set(videocodecidBytes, this.position);
            this.position += 12;
          } else {
            for (i2 = 0; i2 < key.length; i2++) {
              this.bytes[this.position] = key.charCodeAt(i2);
              this.position++;
            }
          }
          this.position++;
          this.view.setFloat64(this.position, val);
          this.position += 8;
          this.length = Math.max(this.length, this.position);
          ++adHoc;
        };
        this.writeMetaDataBoolean = function(key, val) {
          var i2;
          prepareWrite(this, 2);
          this.view.setUint16(this.position, key.length);
          this.position += 2;
          for (i2 = 0; i2 < key.length; i2++) {
            prepareWrite(this, 1);
            this.bytes[this.position] = key.charCodeAt(i2);
            this.position++;
          }
          prepareWrite(this, 2);
          this.view.setUint8(this.position, 1);
          this.position++;
          this.view.setUint8(this.position, val ? 1 : 0);
          this.position++;
          this.length = Math.max(this.length, this.position);
          ++adHoc;
        };
        this.finalize = function() {
          var dtsDelta, len;
          switch (this.bytes[0]) {
            // Video Data
            case _FlvTag.VIDEO_TAG:
              this.bytes[11] = (this.keyFrame || extraData ? 16 : 32) | 7;
              this.bytes[12] = extraData ? 0 : 1;
              dtsDelta = this.pts - this.dts;
              this.bytes[13] = (dtsDelta & 16711680) >>> 16;
              this.bytes[14] = (dtsDelta & 65280) >>> 8;
              this.bytes[15] = (dtsDelta & 255) >>> 0;
              break;
            case _FlvTag.AUDIO_TAG:
              this.bytes[11] = 175;
              this.bytes[12] = extraData ? 0 : 1;
              break;
            case _FlvTag.METADATA_TAG:
              this.position = 11;
              this.view.setUint8(this.position, 2);
              this.position++;
              this.view.setUint16(this.position, 10);
              this.position += 2;
              this.bytes.set([111, 110, 77, 101, 116, 97, 68, 97, 116, 97], this.position);
              this.position += 10;
              this.bytes[this.position] = 8;
              this.position++;
              this.view.setUint32(this.position, adHoc);
              this.position = this.length;
              this.bytes.set([0, 0, 9], this.position);
              this.position += 3;
              this.length = this.position;
              break;
          }
          len = this.length - 11;
          this.bytes[1] = (len & 16711680) >>> 16;
          this.bytes[2] = (len & 65280) >>> 8;
          this.bytes[3] = (len & 255) >>> 0;
          this.bytes[4] = (this.dts & 16711680) >>> 16;
          this.bytes[5] = (this.dts & 65280) >>> 8;
          this.bytes[6] = (this.dts & 255) >>> 0;
          this.bytes[7] = (this.dts & 4278190080) >>> 24;
          this.bytes[8] = 0;
          this.bytes[9] = 0;
          this.bytes[10] = 0;
          prepareWrite(this, 4);
          this.view.setUint32(this.length, this.length);
          this.length += 4;
          this.position += 4;
          this.bytes = this.bytes.subarray(0, this.length);
          this.frameTime = _FlvTag.frameTime(this.bytes);
          return this;
        };
      }, "FlvTag");
      _FlvTag.AUDIO_TAG = 8;
      _FlvTag.VIDEO_TAG = 9;
      _FlvTag.METADATA_TAG = 18;
      _FlvTag.isAudioFrame = function(tag) {
        return _FlvTag.AUDIO_TAG === tag[0];
      };
      _FlvTag.isVideoFrame = function(tag) {
        return _FlvTag.VIDEO_TAG === tag[0];
      };
      _FlvTag.isMetaData = function(tag) {
        return _FlvTag.METADATA_TAG === tag[0];
      };
      _FlvTag.isKeyFrame = function(tag) {
        if (_FlvTag.isVideoFrame(tag)) {
          return tag[11] === 23;
        }
        if (_FlvTag.isAudioFrame(tag)) {
          return true;
        }
        if (_FlvTag.isMetaData(tag)) {
          return true;
        }
        return false;
      };
      _FlvTag.frameTime = function(tag) {
        var pts = tag[4] << 16;
        pts |= tag[5] << 8;
        pts |= tag[6] << 0;
        pts |= tag[7] << 24;
        return pts;
      };
      var flvTag = _FlvTag;
      var CoalesceStream = /* @__PURE__ */ __name(function CoalesceStream2(options) {
        this.numberOfTracks = 0;
        this.metadataStream = options.metadataStream;
        this.videoTags = [];
        this.audioTags = [];
        this.videoTrack = null;
        this.audioTrack = null;
        this.pendingCaptions = [];
        this.pendingMetadata = [];
        this.pendingTracks = 0;
        this.processedTracks = 0;
        CoalesceStream2.prototype.init.call(this);
        this.push = function(output) {
          if (output.content || output.text) {
            return this.pendingCaptions.push(output);
          }
          if (output.frames) {
            return this.pendingMetadata.push(output);
          }
          if (output.track.type === "video") {
            this.videoTrack = output.track;
            this.videoTags = output.tags;
            this.pendingTracks++;
          }
          if (output.track.type === "audio") {
            this.audioTrack = output.track;
            this.audioTags = output.tags;
            this.pendingTracks++;
          }
        };
      }, "CoalesceStream");
      CoalesceStream.prototype = new stream();
      CoalesceStream.prototype.flush = function(flushSource) {
        var id3, caption, i, timelineStartPts, event = {
          tags: {},
          captions: [],
          captionStreams: {},
          metadata: []
        };
        if (this.pendingTracks < this.numberOfTracks) {
          if (flushSource !== "VideoSegmentStream" && flushSource !== "AudioSegmentStream") {
            return;
          } else if (this.pendingTracks === 0) {
            this.processedTracks++;
            if (this.processedTracks < this.numberOfTracks) {
              return;
            }
          }
        }
        this.processedTracks += this.pendingTracks;
        this.pendingTracks = 0;
        if (this.processedTracks < this.numberOfTracks) {
          return;
        }
        if (this.videoTrack) {
          timelineStartPts = this.videoTrack.timelineStartInfo.pts;
        } else if (this.audioTrack) {
          timelineStartPts = this.audioTrack.timelineStartInfo.pts;
        }
        event.tags.videoTags = this.videoTags;
        event.tags.audioTags = this.audioTags;
        for (i = 0; i < this.pendingCaptions.length; i++) {
          caption = this.pendingCaptions[i];
          caption.startTime = caption.startPts - timelineStartPts;
          caption.startTime /= 9e4;
          caption.endTime = caption.endPts - timelineStartPts;
          caption.endTime /= 9e4;
          event.captionStreams[caption.stream] = true;
          event.captions.push(caption);
        }
        for (i = 0; i < this.pendingMetadata.length; i++) {
          id3 = this.pendingMetadata[i];
          id3.cueTime = id3.pts - timelineStartPts;
          id3.cueTime /= 9e4;
          event.metadata.push(id3);
        }
        event.metadata.dispatchType = this.metadataStream.dispatchType;
        this.videoTrack = null;
        this.audioTrack = null;
        this.videoTags = [];
        this.audioTags = [];
        this.pendingCaptions.length = 0;
        this.pendingMetadata.length = 0;
        this.pendingTracks = 0;
        this.processedTracks = 0;
        this.trigger("data", event);
        this.trigger("done");
      };
      var coalesceStream = CoalesceStream;
      var TagList = /* @__PURE__ */ __name(function TagList2() {
        var self2 = this;
        this.list = [];
        this.push = function(tag) {
          this.list.push({
            bytes: tag.bytes,
            dts: tag.dts,
            pts: tag.pts,
            keyFrame: tag.keyFrame,
            metaDataTag: tag.metaDataTag
          });
        };
        Object.defineProperty(this, "length", {
          get: /* @__PURE__ */ __name(function get() {
            return self2.list.length;
          }, "get")
        });
      }, "TagList");
      var tagList = TagList;
      var H264Stream = h264.H264Stream;
      var _Transmuxer, _VideoSegmentStream, _AudioSegmentStream, collectTimelineInfo, metaDataTag, extraDataTag;
      collectTimelineInfo = /* @__PURE__ */ __name(function collectTimelineInfo2(track, data) {
        if (typeof data.pts === "number") {
          if (track.timelineStartInfo.pts === void 0) {
            track.timelineStartInfo.pts = data.pts;
          } else {
            track.timelineStartInfo.pts = Math.min(track.timelineStartInfo.pts, data.pts);
          }
        }
        if (typeof data.dts === "number") {
          if (track.timelineStartInfo.dts === void 0) {
            track.timelineStartInfo.dts = data.dts;
          } else {
            track.timelineStartInfo.dts = Math.min(track.timelineStartInfo.dts, data.dts);
          }
        }
      }, "collectTimelineInfo");
      metaDataTag = /* @__PURE__ */ __name(function metaDataTag2(track, pts) {
        var tag = new flvTag(flvTag.METADATA_TAG);
        tag.dts = pts;
        tag.pts = pts;
        tag.writeMetaDataDouble("videocodecid", 7);
        tag.writeMetaDataDouble("width", track.width);
        tag.writeMetaDataDouble("height", track.height);
        return tag;
      }, "metaDataTag");
      extraDataTag = /* @__PURE__ */ __name(function extraDataTag2(track, pts) {
        var i, tag = new flvTag(flvTag.VIDEO_TAG, true);
        tag.dts = pts;
        tag.pts = pts;
        tag.writeByte(1);
        tag.writeByte(track.profileIdc);
        tag.writeByte(track.profileCompatibility);
        tag.writeByte(track.levelIdc);
        tag.writeByte(252 | 3);
        tag.writeByte(224 | 1);
        tag.writeShort(track.sps[0].length);
        tag.writeBytes(track.sps[0]);
        tag.writeByte(track.pps.length);
        for (i = 0; i < track.pps.length; ++i) {
          tag.writeShort(track.pps[i].length);
          tag.writeBytes(track.pps[i]);
        }
        return tag;
      }, "extraDataTag");
      _AudioSegmentStream = /* @__PURE__ */ __name(function AudioSegmentStream2(track) {
        var adtsFrames = [], videoKeyFrames = [], oldExtraData;
        _AudioSegmentStream.prototype.init.call(this);
        this.push = function(data) {
          collectTimelineInfo(track, data);
          if (track) {
            track.audioobjecttype = data.audioobjecttype;
            track.channelcount = data.channelcount;
            track.samplerate = data.samplerate;
            track.samplingfrequencyindex = data.samplingfrequencyindex;
            track.samplesize = data.samplesize;
            track.extraData = track.audioobjecttype << 11 | track.samplingfrequencyindex << 7 | track.channelcount << 3;
          }
          data.pts = Math.round(data.pts / 90);
          data.dts = Math.round(data.dts / 90);
          adtsFrames.push(data);
        };
        this.flush = function() {
          var currentFrame, adtsFrame, lastMetaPts, tags = new tagList();
          if (adtsFrames.length === 0) {
            this.trigger("done", "AudioSegmentStream");
            return;
          }
          lastMetaPts = -Infinity;
          while (adtsFrames.length) {
            currentFrame = adtsFrames.shift();
            if (videoKeyFrames.length && currentFrame.pts >= videoKeyFrames[0]) {
              lastMetaPts = videoKeyFrames.shift();
              this.writeMetaDataTags(tags, lastMetaPts);
            }
            if (track.extraData !== oldExtraData || currentFrame.pts - lastMetaPts >= 1e3) {
              this.writeMetaDataTags(tags, currentFrame.pts);
              oldExtraData = track.extraData;
              lastMetaPts = currentFrame.pts;
            }
            adtsFrame = new flvTag(flvTag.AUDIO_TAG);
            adtsFrame.pts = currentFrame.pts;
            adtsFrame.dts = currentFrame.dts;
            adtsFrame.writeBytes(currentFrame.data);
            tags.push(adtsFrame.finalize());
          }
          videoKeyFrames.length = 0;
          oldExtraData = null;
          this.trigger("data", {
            track,
            tags: tags.list
          });
          this.trigger("done", "AudioSegmentStream");
        };
        this.writeMetaDataTags = function(tags, pts) {
          var adtsFrame;
          adtsFrame = new flvTag(flvTag.METADATA_TAG);
          adtsFrame.pts = pts;
          adtsFrame.dts = pts;
          adtsFrame.writeMetaDataDouble("audiocodecid", 10);
          adtsFrame.writeMetaDataBoolean("stereo", track.channelcount === 2);
          adtsFrame.writeMetaDataDouble("audiosamplerate", track.samplerate);
          adtsFrame.writeMetaDataDouble("audiosamplesize", 16);
          tags.push(adtsFrame.finalize());
          adtsFrame = new flvTag(flvTag.AUDIO_TAG, true);
          adtsFrame.pts = pts;
          adtsFrame.dts = pts;
          adtsFrame.view.setUint16(adtsFrame.position, track.extraData);
          adtsFrame.position += 2;
          adtsFrame.length = Math.max(adtsFrame.length, adtsFrame.position);
          tags.push(adtsFrame.finalize());
        };
        this.onVideoKeyFrame = function(pts) {
          videoKeyFrames.push(pts);
        };
      }, "AudioSegmentStream");
      _AudioSegmentStream.prototype = new stream();
      _VideoSegmentStream = /* @__PURE__ */ __name(function VideoSegmentStream2(track) {
        var nalUnits = [], config, h264Frame;
        _VideoSegmentStream.prototype.init.call(this);
        this.finishFrame = function(tags, frame) {
          if (!frame) {
            return;
          }
          if (config && track && track.newMetadata && (frame.keyFrame || tags.length === 0)) {
            var metaTag = metaDataTag(config, frame.dts).finalize();
            var extraTag = extraDataTag(track, frame.dts).finalize();
            metaTag.metaDataTag = extraTag.metaDataTag = true;
            tags.push(metaTag);
            tags.push(extraTag);
            track.newMetadata = false;
            this.trigger("keyframe", frame.dts);
          }
          frame.endNalUnit();
          tags.push(frame.finalize());
          h264Frame = null;
        };
        this.push = function(data) {
          collectTimelineInfo(track, data);
          data.pts = Math.round(data.pts / 90);
          data.dts = Math.round(data.dts / 90);
          nalUnits.push(data);
        };
        this.flush = function() {
          var currentNal, tags = new tagList();
          while (nalUnits.length) {
            if (nalUnits[0].nalUnitType === "access_unit_delimiter_rbsp") {
              break;
            }
            nalUnits.shift();
          }
          if (nalUnits.length === 0) {
            this.trigger("done", "VideoSegmentStream");
            return;
          }
          while (nalUnits.length) {
            currentNal = nalUnits.shift();
            if (currentNal.nalUnitType === "seq_parameter_set_rbsp") {
              track.newMetadata = true;
              config = currentNal.config;
              track.width = config.width;
              track.height = config.height;
              track.sps = [currentNal.data];
              track.profileIdc = config.profileIdc;
              track.levelIdc = config.levelIdc;
              track.profileCompatibility = config.profileCompatibility;
              h264Frame.endNalUnit();
            } else if (currentNal.nalUnitType === "pic_parameter_set_rbsp") {
              track.newMetadata = true;
              track.pps = [currentNal.data];
              h264Frame.endNalUnit();
            } else if (currentNal.nalUnitType === "access_unit_delimiter_rbsp") {
              if (h264Frame) {
                this.finishFrame(tags, h264Frame);
              }
              h264Frame = new flvTag(flvTag.VIDEO_TAG);
              h264Frame.pts = currentNal.pts;
              h264Frame.dts = currentNal.dts;
            } else {
              if (currentNal.nalUnitType === "slice_layer_without_partitioning_rbsp_idr") {
                h264Frame.keyFrame = true;
              }
              h264Frame.endNalUnit();
            }
            h264Frame.startNalUnit();
            h264Frame.writeBytes(currentNal.data);
          }
          if (h264Frame) {
            this.finishFrame(tags, h264Frame);
          }
          this.trigger("data", {
            track,
            tags: tags.list
          });
          this.trigger("done", "VideoSegmentStream");
        };
      }, "VideoSegmentStream");
      _VideoSegmentStream.prototype = new stream();
      _Transmuxer = /* @__PURE__ */ __name(function Transmuxer2(options) {
        var self2 = this, packetStream, parseStream, elementaryStream, videoTimestampRolloverStream, audioTimestampRolloverStream, timedMetadataTimestampRolloverStream, adtsStream, h264Stream, videoSegmentStream2, audioSegmentStream2, captionStream2, coalesceStream$1;
        _Transmuxer.prototype.init.call(this);
        options = options || {};
        this.metadataStream = new m2ts_1.MetadataStream();
        options.metadataStream = this.metadataStream;
        packetStream = new m2ts_1.TransportPacketStream();
        parseStream = new m2ts_1.TransportParseStream();
        elementaryStream = new m2ts_1.ElementaryStream();
        videoTimestampRolloverStream = new m2ts_1.TimestampRolloverStream("video");
        audioTimestampRolloverStream = new m2ts_1.TimestampRolloverStream("audio");
        timedMetadataTimestampRolloverStream = new m2ts_1.TimestampRolloverStream("timed-metadata");
        adtsStream = new adts();
        h264Stream = new H264Stream();
        coalesceStream$1 = new coalesceStream(options);
        packetStream.pipe(parseStream).pipe(elementaryStream);
        elementaryStream.pipe(videoTimestampRolloverStream).pipe(h264Stream);
        elementaryStream.pipe(audioTimestampRolloverStream).pipe(adtsStream);
        elementaryStream.pipe(timedMetadataTimestampRolloverStream).pipe(this.metadataStream).pipe(coalesceStream$1);
        captionStream2 = new m2ts_1.CaptionStream(options);
        h264Stream.pipe(captionStream2).pipe(coalesceStream$1);
        elementaryStream.on("data", function(data) {
          var i, videoTrack, audioTrack;
          if (data.type === "metadata") {
            i = data.tracks.length;
            while (i--) {
              if (data.tracks[i].type === "video") {
                videoTrack = data.tracks[i];
              } else if (data.tracks[i].type === "audio") {
                audioTrack = data.tracks[i];
              }
            }
            if (videoTrack && !videoSegmentStream2) {
              coalesceStream$1.numberOfTracks++;
              videoSegmentStream2 = new _VideoSegmentStream(videoTrack);
              h264Stream.pipe(videoSegmentStream2).pipe(coalesceStream$1);
            }
            if (audioTrack && !audioSegmentStream2) {
              coalesceStream$1.numberOfTracks++;
              audioSegmentStream2 = new _AudioSegmentStream(audioTrack);
              adtsStream.pipe(audioSegmentStream2).pipe(coalesceStream$1);
              if (videoSegmentStream2) {
                videoSegmentStream2.on("keyframe", audioSegmentStream2.onVideoKeyFrame);
              }
            }
          }
        });
        this.push = function(data) {
          packetStream.push(data);
        };
        this.flush = function() {
          packetStream.flush();
        };
        this.resetCaptions = function() {
          captionStream2.reset();
        };
        coalesceStream$1.on("data", function(event) {
          self2.trigger("data", event);
        });
        coalesceStream$1.on("done", function() {
          self2.trigger("done");
        });
      }, "Transmuxer");
      _Transmuxer.prototype = new stream();
      var transmuxer$1 = _Transmuxer;
      var getFlvHeader = /* @__PURE__ */ __name(function getFlvHeader2(duration, audio, video) {
        var headBytes = new Uint8Array(3 + 1 + 1 + 4), head = new DataView(headBytes.buffer), metadata, result, metadataLength;
        duration = duration || 0;
        audio = audio === void 0 ? true : audio;
        video = video === void 0 ? true : video;
        head.setUint8(0, 70);
        head.setUint8(1, 76);
        head.setUint8(2, 86);
        head.setUint8(3, 1);
        head.setUint8(4, (audio ? 4 : 0) | (video ? 1 : 0));
        head.setUint32(5, headBytes.byteLength);
        if (duration <= 0) {
          result = new Uint8Array(headBytes.byteLength + 4);
          result.set(headBytes);
          result.set([0, 0, 0, 0], headBytes.byteLength);
          return result;
        }
        metadata = new flvTag(flvTag.METADATA_TAG);
        metadata.pts = metadata.dts = 0;
        metadata.writeMetaDataDouble("duration", duration);
        metadataLength = metadata.finalize().length;
        result = new Uint8Array(headBytes.byteLength + metadataLength);
        result.set(headBytes);
        result.set(head.byteLength, metadataLength);
        return result;
      }, "getFlvHeader");
      var flvHeader = getFlvHeader;
      var flv = {
        tag: flvTag,
        Transmuxer: transmuxer$1,
        getFlvHeader: flvHeader
      };
      var m2ts = m2ts_1;
      var ONE_SECOND_IN_TS$1 = clock.ONE_SECOND_IN_TS;
      var AudioSegmentStream = /* @__PURE__ */ __name(function AudioSegmentStream2(track, options) {
        var adtsFrames = [], sequenceNumber = 0, earliestAllowedDts = 0, audioAppendStartTs = 0, videoBaseMediaDecodeTime = Infinity, segmentStartPts = null, segmentEndPts = null;
        options = options || {};
        AudioSegmentStream2.prototype.init.call(this);
        this.push = function(data) {
          trackDecodeInfo.collectDtsInfo(track, data);
          if (track) {
            audioProperties.forEach(function(prop) {
              track[prop] = data[prop];
            });
          }
          adtsFrames.push(data);
        };
        this.setEarliestDts = function(earliestDts) {
          earliestAllowedDts = earliestDts;
        };
        this.setVideoBaseMediaDecodeTime = function(baseMediaDecodeTime) {
          videoBaseMediaDecodeTime = baseMediaDecodeTime;
        };
        this.setAudioAppendStart = function(timestamp) {
          audioAppendStartTs = timestamp;
        };
        this.processFrames_ = function() {
          var frames, moof2, mdat2, boxes, timingInfo;
          if (adtsFrames.length === 0) {
            return;
          }
          frames = audioFrameUtils.trimAdtsFramesByEarliestDts(adtsFrames, track, earliestAllowedDts);
          if (frames.length === 0) {
            return;
          }
          track.baseMediaDecodeTime = trackDecodeInfo.calculateTrackBaseMediaDecodeTime(track, options.keepOriginalTimestamps);
          audioFrameUtils.prefixWithSilence(track, frames, audioAppendStartTs, videoBaseMediaDecodeTime);
          track.samples = audioFrameUtils.generateSampleTable(frames);
          mdat2 = mp4Generator.mdat(audioFrameUtils.concatenateFrameData(frames));
          adtsFrames = [];
          moof2 = mp4Generator.moof(sequenceNumber, [track]);
          sequenceNumber++;
          track.initSegment = mp4Generator.initSegment([track]);
          boxes = new Uint8Array(moof2.byteLength + mdat2.byteLength);
          boxes.set(moof2);
          boxes.set(mdat2, moof2.byteLength);
          trackDecodeInfo.clearDtsInfo(track);
          if (segmentStartPts === null) {
            segmentEndPts = segmentStartPts = frames[0].pts;
          }
          segmentEndPts += frames.length * (ONE_SECOND_IN_TS$1 * 1024 / track.samplerate);
          timingInfo = {
            start: segmentStartPts
          };
          this.trigger("timingInfo", timingInfo);
          this.trigger("data", {
            track,
            boxes
          });
        };
        this.flush = function() {
          this.processFrames_();
          this.trigger("timingInfo", {
            start: segmentStartPts,
            end: segmentEndPts
          });
          this.resetTiming_();
          this.trigger("done", "AudioSegmentStream");
        };
        this.partialFlush = function() {
          this.processFrames_();
          this.trigger("partialdone", "AudioSegmentStream");
        };
        this.endTimeline = function() {
          this.flush();
          this.trigger("endedtimeline", "AudioSegmentStream");
        };
        this.resetTiming_ = function() {
          trackDecodeInfo.clearDtsInfo(track);
          segmentStartPts = null;
          segmentEndPts = null;
        };
        this.reset = function() {
          this.resetTiming_();
          adtsFrames = [];
          this.trigger("reset");
        };
      }, "AudioSegmentStream");
      AudioSegmentStream.prototype = new stream();
      var audioSegmentStream = AudioSegmentStream;
      var VideoSegmentStream = /* @__PURE__ */ __name(function VideoSegmentStream2(track, options) {
        var sequenceNumber = 0, nalUnits = [], frameCache = [], config, pps, segmentStartPts = null, segmentEndPts = null, gops, ensureNextFrameIsKeyFrame = true;
        options = options || {};
        VideoSegmentStream2.prototype.init.call(this);
        this.push = function(nalUnit) {
          trackDecodeInfo.collectDtsInfo(track, nalUnit);
          if (typeof track.timelineStartInfo.dts === "undefined") {
            track.timelineStartInfo.dts = nalUnit.dts;
          }
          if (nalUnit.nalUnitType === "seq_parameter_set_rbsp" && !config) {
            config = nalUnit.config;
            track.sps = [nalUnit.data];
            videoProperties.forEach(function(prop) {
              track[prop] = config[prop];
            }, this);
          }
          if (nalUnit.nalUnitType === "pic_parameter_set_rbsp" && !pps) {
            pps = nalUnit.data;
            track.pps = [nalUnit.data];
          }
          nalUnits.push(nalUnit);
        };
        this.processNals_ = function(cacheLastFrame) {
          var i;
          nalUnits = frameCache.concat(nalUnits);
          while (nalUnits.length) {
            if (nalUnits[0].nalUnitType === "access_unit_delimiter_rbsp") {
              break;
            }
            nalUnits.shift();
          }
          if (nalUnits.length === 0) {
            return;
          }
          var frames = frameUtils.groupNalsIntoFrames(nalUnits);
          if (!frames.length) {
            return;
          }
          frameCache = frames[frames.length - 1];
          if (cacheLastFrame) {
            frames.pop();
            frames.duration -= frameCache.duration;
            frames.nalCount -= frameCache.length;
            frames.byteLength -= frameCache.byteLength;
          }
          if (!frames.length) {
            nalUnits = [];
            return;
          }
          this.trigger("timelineStartInfo", track.timelineStartInfo);
          if (ensureNextFrameIsKeyFrame) {
            gops = frameUtils.groupFramesIntoGops(frames);
            if (!gops[0][0].keyFrame) {
              gops = frameUtils.extendFirstKeyFrame(gops);
              if (!gops[0][0].keyFrame) {
                nalUnits = [].concat.apply([], frames).concat(frameCache);
                frameCache = [];
                return;
              }
              frames = [].concat.apply([], gops);
              frames.duration = gops.duration;
            }
            ensureNextFrameIsKeyFrame = false;
          }
          if (segmentStartPts === null) {
            segmentStartPts = frames[0].pts;
            segmentEndPts = segmentStartPts;
          }
          segmentEndPts += frames.duration;
          this.trigger("timingInfo", {
            start: segmentStartPts,
            end: segmentEndPts
          });
          for (i = 0; i < frames.length; i++) {
            var frame = frames[i];
            track.samples = frameUtils.generateSampleTableForFrame(frame);
            var mdat2 = mp4Generator.mdat(frameUtils.concatenateNalDataForFrame(frame));
            trackDecodeInfo.clearDtsInfo(track);
            trackDecodeInfo.collectDtsInfo(track, frame);
            track.baseMediaDecodeTime = trackDecodeInfo.calculateTrackBaseMediaDecodeTime(track, options.keepOriginalTimestamps);
            var moof2 = mp4Generator.moof(sequenceNumber, [track]);
            sequenceNumber++;
            track.initSegment = mp4Generator.initSegment([track]);
            var boxes = new Uint8Array(moof2.byteLength + mdat2.byteLength);
            boxes.set(moof2);
            boxes.set(mdat2, moof2.byteLength);
            this.trigger("data", {
              track,
              boxes,
              sequence: sequenceNumber,
              videoFrameDts: frame.dts,
              videoFramePts: frame.pts
            });
          }
          nalUnits = [];
        };
        this.resetTimingAndConfig_ = function() {
          config = void 0;
          pps = void 0;
          segmentStartPts = null;
          segmentEndPts = null;
        };
        this.partialFlush = function() {
          this.processNals_(true);
          this.trigger("partialdone", "VideoSegmentStream");
        };
        this.flush = function() {
          this.processNals_(false);
          this.resetTimingAndConfig_();
          this.trigger("done", "VideoSegmentStream");
        };
        this.endTimeline = function() {
          this.flush();
          this.trigger("endedtimeline", "VideoSegmentStream");
        };
        this.reset = function() {
          this.resetTimingAndConfig_();
          frameCache = [];
          nalUnits = [];
          ensureNextFrameIsKeyFrame = true;
          this.trigger("reset");
        };
      }, "VideoSegmentStream");
      VideoSegmentStream.prototype = new stream();
      var videoSegmentStream = VideoSegmentStream;
      var isLikelyAacData = utils.isLikelyAacData;
      var createPipeline = /* @__PURE__ */ __name(function createPipeline2(object) {
        object.prototype = new stream();
        object.prototype.init.call(object);
        return object;
      }, "createPipeline");
      var tsPipeline = /* @__PURE__ */ __name(function tsPipeline2(options) {
        var pipeline = {
          type: "ts",
          tracks: {
            audio: null,
            video: null
          },
          packet: new m2ts_1.TransportPacketStream(),
          parse: new m2ts_1.TransportParseStream(),
          elementary: new m2ts_1.ElementaryStream(),
          timestampRollover: new m2ts_1.TimestampRolloverStream(),
          adts: new codecs.Adts(),
          h264: new codecs.h264.H264Stream(),
          captionStream: new m2ts_1.CaptionStream(options),
          metadataStream: new m2ts_1.MetadataStream()
        };
        pipeline.headOfPipeline = pipeline.packet;
        pipeline.packet.pipe(pipeline.parse).pipe(pipeline.elementary).pipe(pipeline.timestampRollover);
        pipeline.timestampRollover.pipe(pipeline.h264);
        pipeline.h264.pipe(pipeline.captionStream);
        pipeline.timestampRollover.pipe(pipeline.metadataStream);
        pipeline.timestampRollover.pipe(pipeline.adts);
        pipeline.elementary.on("data", function(data) {
          if (data.type !== "metadata") {
            return;
          }
          for (var i = 0; i < data.tracks.length; i++) {
            if (!pipeline.tracks[data.tracks[i].type]) {
              pipeline.tracks[data.tracks[i].type] = data.tracks[i];
              pipeline.tracks[data.tracks[i].type].timelineStartInfo.baseMediaDecodeTime = options.baseMediaDecodeTime;
            }
          }
          if (pipeline.tracks.video && !pipeline.videoSegmentStream) {
            pipeline.videoSegmentStream = new videoSegmentStream(pipeline.tracks.video, options);
            pipeline.videoSegmentStream.on("timelineStartInfo", function(timelineStartInfo) {
              if (pipeline.tracks.audio && !options.keepOriginalTimestamps) {
                pipeline.audioSegmentStream.setEarliestDts(timelineStartInfo.dts - options.baseMediaDecodeTime);
              }
            });
            pipeline.videoSegmentStream.on("timingInfo", pipeline.trigger.bind(pipeline, "videoTimingInfo"));
            pipeline.videoSegmentStream.on("data", function(data2) {
              pipeline.trigger("data", {
                type: "video",
                data: data2
              });
            });
            pipeline.videoSegmentStream.on("done", pipeline.trigger.bind(pipeline, "done"));
            pipeline.videoSegmentStream.on("partialdone", pipeline.trigger.bind(pipeline, "partialdone"));
            pipeline.videoSegmentStream.on("endedtimeline", pipeline.trigger.bind(pipeline, "endedtimeline"));
            pipeline.h264.pipe(pipeline.videoSegmentStream);
          }
          if (pipeline.tracks.audio && !pipeline.audioSegmentStream) {
            pipeline.audioSegmentStream = new audioSegmentStream(pipeline.tracks.audio, options);
            pipeline.audioSegmentStream.on("data", function(data2) {
              pipeline.trigger("data", {
                type: "audio",
                data: data2
              });
            });
            pipeline.audioSegmentStream.on("done", pipeline.trigger.bind(pipeline, "done"));
            pipeline.audioSegmentStream.on("partialdone", pipeline.trigger.bind(pipeline, "partialdone"));
            pipeline.audioSegmentStream.on("endedtimeline", pipeline.trigger.bind(pipeline, "endedtimeline"));
            pipeline.audioSegmentStream.on("timingInfo", pipeline.trigger.bind(pipeline, "audioTimingInfo"));
            pipeline.adts.pipe(pipeline.audioSegmentStream);
          }
          pipeline.trigger("trackinfo", {
            hasAudio: !!pipeline.tracks.audio,
            hasVideo: !!pipeline.tracks.video
          });
        });
        pipeline.captionStream.on("data", function(caption) {
          var timelineStartPts;
          if (pipeline.tracks.video) {
            timelineStartPts = pipeline.tracks.video.timelineStartInfo.pts || 0;
          } else {
            timelineStartPts = 0;
          }
          caption.startTime = clock.metadataTsToSeconds(caption.startPts, timelineStartPts, options.keepOriginalTimestamps);
          caption.endTime = clock.metadataTsToSeconds(caption.endPts, timelineStartPts, options.keepOriginalTimestamps);
          pipeline.trigger("caption", caption);
        });
        pipeline = createPipeline(pipeline);
        pipeline.metadataStream.on("data", pipeline.trigger.bind(pipeline, "id3Frame"));
        return pipeline;
      }, "tsPipeline");
      var aacPipeline = /* @__PURE__ */ __name(function aacPipeline2(options) {
        var pipeline = {
          type: "aac",
          tracks: {
            audio: null
          },
          metadataStream: new m2ts_1.MetadataStream(),
          aacStream: new aac(),
          audioRollover: new m2ts_1.TimestampRolloverStream("audio"),
          timedMetadataRollover: new m2ts_1.TimestampRolloverStream("timed-metadata"),
          adtsStream: new adts(true)
        };
        pipeline.headOfPipeline = pipeline.aacStream;
        pipeline.aacStream.pipe(pipeline.audioRollover).pipe(pipeline.adtsStream);
        pipeline.aacStream.pipe(pipeline.timedMetadataRollover).pipe(pipeline.metadataStream);
        pipeline.metadataStream.on("timestamp", function(frame) {
          pipeline.aacStream.setTimestamp(frame.timeStamp);
        });
        pipeline.aacStream.on("data", function(data) {
          if (data.type !== "timed-metadata" && data.type !== "audio" || pipeline.audioSegmentStream) {
            return;
          }
          pipeline.tracks.audio = pipeline.tracks.audio || {
            timelineStartInfo: {
              baseMediaDecodeTime: options.baseMediaDecodeTime
            },
            codec: "adts",
            type: "audio"
          };
          pipeline.audioSegmentStream = new audioSegmentStream(pipeline.tracks.audio, options);
          pipeline.audioSegmentStream.on("data", function(data2) {
            pipeline.trigger("data", {
              type: "audio",
              data: data2
            });
          });
          pipeline.audioSegmentStream.on("partialdone", pipeline.trigger.bind(pipeline, "partialdone"));
          pipeline.audioSegmentStream.on("done", pipeline.trigger.bind(pipeline, "done"));
          pipeline.audioSegmentStream.on("endedtimeline", pipeline.trigger.bind(pipeline, "endedtimeline"));
          pipeline.audioSegmentStream.on("timingInfo", pipeline.trigger.bind(pipeline, "audioTimingInfo"));
          pipeline.adtsStream.pipe(pipeline.audioSegmentStream);
          pipeline.trigger("trackinfo", {
            hasAudio: !!pipeline.tracks.audio,
            hasVideo: !!pipeline.tracks.video
          });
        });
        pipeline = createPipeline(pipeline);
        pipeline.metadataStream.on("data", pipeline.trigger.bind(pipeline, "id3Frame"));
        return pipeline;
      }, "aacPipeline");
      var setupPipelineListeners = /* @__PURE__ */ __name(function setupPipelineListeners2(pipeline, transmuxer2) {
        pipeline.on("data", transmuxer2.trigger.bind(transmuxer2, "data"));
        pipeline.on("done", transmuxer2.trigger.bind(transmuxer2, "done"));
        pipeline.on("partialdone", transmuxer2.trigger.bind(transmuxer2, "partialdone"));
        pipeline.on("endedtimeline", transmuxer2.trigger.bind(transmuxer2, "endedtimeline"));
        pipeline.on("audioTimingInfo", transmuxer2.trigger.bind(transmuxer2, "audioTimingInfo"));
        pipeline.on("videoTimingInfo", transmuxer2.trigger.bind(transmuxer2, "videoTimingInfo"));
        pipeline.on("trackinfo", transmuxer2.trigger.bind(transmuxer2, "trackinfo"));
        pipeline.on("id3Frame", function(event) {
          event.dispatchType = pipeline.metadataStream.dispatchType;
          event.cueTime = clock.videoTsToSeconds(event.pts);
          transmuxer2.trigger("id3Frame", event);
        });
        pipeline.on("caption", function(event) {
          transmuxer2.trigger("caption", event);
        });
      }, "setupPipelineListeners");
      var Transmuxer = /* @__PURE__ */ __name(function Transmuxer2(options) {
        var pipeline = null, hasFlushed = true;
        options = options || {};
        Transmuxer2.prototype.init.call(this);
        options.baseMediaDecodeTime = options.baseMediaDecodeTime || 0;
        this.push = function(bytes) {
          if (hasFlushed) {
            var isAac = isLikelyAacData(bytes);
            if (isAac && (!pipeline || pipeline.type !== "aac")) {
              pipeline = aacPipeline(options);
              setupPipelineListeners(pipeline, this);
            } else if (!isAac && (!pipeline || pipeline.type !== "ts")) {
              pipeline = tsPipeline(options);
              setupPipelineListeners(pipeline, this);
            }
            hasFlushed = false;
          }
          pipeline.headOfPipeline.push(bytes);
        };
        this.flush = function() {
          if (!pipeline) {
            return;
          }
          hasFlushed = true;
          pipeline.headOfPipeline.flush();
        };
        this.partialFlush = function() {
          if (!pipeline) {
            return;
          }
          pipeline.headOfPipeline.partialFlush();
        };
        this.endTimeline = function() {
          if (!pipeline) {
            return;
          }
          pipeline.headOfPipeline.endTimeline();
        };
        this.reset = function() {
          if (!pipeline) {
            return;
          }
          pipeline.headOfPipeline.reset();
        };
        this.setBaseMediaDecodeTime = function(baseMediaDecodeTime) {
          if (!options.keepOriginalTimestamps) {
            options.baseMediaDecodeTime = baseMediaDecodeTime;
          }
          if (!pipeline) {
            return;
          }
          if (pipeline.tracks.audio) {
            pipeline.tracks.audio.timelineStartInfo.dts = void 0;
            pipeline.tracks.audio.timelineStartInfo.pts = void 0;
            trackDecodeInfo.clearDtsInfo(pipeline.tracks.audio);
            if (pipeline.audioRollover) {
              pipeline.audioRollover.discontinuity();
            }
          }
          if (pipeline.tracks.video) {
            if (pipeline.videoSegmentStream) {
              pipeline.videoSegmentStream.gopCache_ = [];
            }
            pipeline.tracks.video.timelineStartInfo.dts = void 0;
            pipeline.tracks.video.timelineStartInfo.pts = void 0;
            trackDecodeInfo.clearDtsInfo(pipeline.tracks.video);
          }
          if (pipeline.timestampRollover) {
            pipeline.timestampRollover.discontinuity();
          }
        };
        this.setRemux = function(val) {
          options.remux = val;
          if (pipeline && pipeline.coalesceStream) {
            pipeline.coalesceStream.setRemux(val);
          }
        };
        this.setAudioAppendStart = function(audioAppendStart) {
          if (!pipeline || !pipeline.tracks.audio || !pipeline.audioSegmentStream) {
            return;
          }
          pipeline.audioSegmentStream.setAudioAppendStart(audioAppendStart);
        };
        this.alignGopsWith = function(gopsToAlignWith) {
          return;
        };
      }, "Transmuxer");
      Transmuxer.prototype = new stream();
      var transmuxer = Transmuxer;
      var partial = {
        Transmuxer: transmuxer
      };
      var tagTypes = {
        8: "audio",
        9: "video",
        18: "metadata"
      }, hex = /* @__PURE__ */ __name(function hex2(val) {
        return "0x" + ("00" + val.toString(16)).slice(-2).toUpperCase();
      }, "hex"), hexStringList = /* @__PURE__ */ __name(function hexStringList2(data) {
        var arr = [], i;
        while (data.byteLength > 0) {
          i = 0;
          arr.push(hex(data[i++]));
          data = data.subarray(i);
        }
        return arr.join(" ");
      }, "hexStringList"), parseAVCTag = /* @__PURE__ */ __name(function parseAVCTag2(tag, obj) {
        var avcPacketTypes = ["AVC Sequence Header", "AVC NALU", "AVC End-of-Sequence"], compositionTime = tag[1] & parseInt("01111111", 2) << 16 | tag[2] << 8 | tag[3];
        obj = obj || {};
        obj.avcPacketType = avcPacketTypes[tag[0]];
        obj.CompositionTime = tag[1] & parseInt("10000000", 2) ? -compositionTime : compositionTime;
        if (tag[0] === 1) {
          obj.nalUnitTypeRaw = hexStringList(tag.subarray(4, 100));
        } else {
          obj.data = hexStringList(tag.subarray(4));
        }
        return obj;
      }, "parseAVCTag"), parseVideoTag = /* @__PURE__ */ __name(function parseVideoTag2(tag, obj) {
        var frameTypes = ["Unknown", "Keyframe (for AVC, a seekable frame)", "Inter frame (for AVC, a nonseekable frame)", "Disposable inter frame (H.263 only)", "Generated keyframe (reserved for server use only)", "Video info/command frame"], codecID = tag[0] & parseInt("00001111", 2);
        obj = obj || {};
        obj.frameType = frameTypes[(tag[0] & parseInt("11110000", 2)) >>> 4];
        obj.codecID = codecID;
        if (codecID === 7) {
          return parseAVCTag(tag.subarray(1), obj);
        }
        return obj;
      }, "parseVideoTag"), parseAACTag = /* @__PURE__ */ __name(function parseAACTag2(tag, obj) {
        var packetTypes = ["AAC Sequence Header", "AAC Raw"];
        obj = obj || {};
        obj.aacPacketType = packetTypes[tag[0]];
        obj.data = hexStringList(tag.subarray(1));
        return obj;
      }, "parseAACTag"), parseAudioTag = /* @__PURE__ */ __name(function parseAudioTag2(tag, obj) {
        var formatTable = ["Linear PCM, platform endian", "ADPCM", "MP3", "Linear PCM, little endian", "Nellymoser 16-kHz mono", "Nellymoser 8-kHz mono", "Nellymoser", "G.711 A-law logarithmic PCM", "G.711 mu-law logarithmic PCM", "reserved", "AAC", "Speex", "MP3 8-Khz", "Device-specific sound"], samplingRateTable = ["5.5-kHz", "11-kHz", "22-kHz", "44-kHz"], soundFormat = (tag[0] & parseInt("11110000", 2)) >>> 4;
        obj = obj || {};
        obj.soundFormat = formatTable[soundFormat];
        obj.soundRate = samplingRateTable[(tag[0] & parseInt("00001100", 2)) >>> 2];
        obj.soundSize = (tag[0] & parseInt("00000010", 2)) >>> 1 ? "16-bit" : "8-bit";
        obj.soundType = tag[0] & parseInt("00000001", 2) ? "Stereo" : "Mono";
        if (soundFormat === 10) {
          return parseAACTag(tag.subarray(1), obj);
        }
        return obj;
      }, "parseAudioTag"), parseGenericTag = /* @__PURE__ */ __name(function parseGenericTag2(tag) {
        return {
          tagType: tagTypes[tag[0]],
          dataSize: tag[1] << 16 | tag[2] << 8 | tag[3],
          timestamp: tag[7] << 24 | tag[4] << 16 | tag[5] << 8 | tag[6],
          streamID: tag[8] << 16 | tag[9] << 8 | tag[10]
        };
      }, "parseGenericTag"), inspectFlvTag = /* @__PURE__ */ __name(function inspectFlvTag2(tag) {
        var header = parseGenericTag(tag);
        switch (tag[0]) {
          case 8:
            parseAudioTag(tag.subarray(11), header);
            break;
          case 9:
            parseVideoTag(tag.subarray(11), header);
            break;
        }
        return header;
      }, "inspectFlvTag"), inspectFlv = /* @__PURE__ */ __name(function inspectFlv2(bytes) {
        var i = 9, dataSize, parsedResults = [], tag;
        i += 4;
        while (i < bytes.byteLength) {
          dataSize = bytes[i + 1] << 16;
          dataSize |= bytes[i + 2] << 8;
          dataSize |= bytes[i + 3];
          dataSize += 11;
          tag = bytes.subarray(i, i + dataSize);
          parsedResults.push(inspectFlvTag(tag));
          i += dataSize + 4;
        }
        return parsedResults;
      }, "inspectFlv"), textifyFlv = /* @__PURE__ */ __name(function textifyFlv2(flvTagArray) {
        return JSON.stringify(flvTagArray, null, 2);
      }, "textifyFlv");
      var flvInspector = {
        inspectTag: inspectFlvTag,
        inspect: inspectFlv,
        textify: textifyFlv
      };
      var parsePid = /* @__PURE__ */ __name(function parsePid2(packet) {
        var pid = packet[1] & 31;
        pid <<= 8;
        pid |= packet[2];
        return pid;
      }, "parsePid");
      var parsePayloadUnitStartIndicator = /* @__PURE__ */ __name(function parsePayloadUnitStartIndicator2(packet) {
        return !!(packet[1] & 64);
      }, "parsePayloadUnitStartIndicator");
      var parseAdaptionField = /* @__PURE__ */ __name(function parseAdaptionField2(packet) {
        var offset = 0;
        if ((packet[3] & 48) >>> 4 > 1) {
          offset += packet[4] + 1;
        }
        return offset;
      }, "parseAdaptionField");
      var parseType = /* @__PURE__ */ __name(function parseType2(packet, pmtPid) {
        var pid = parsePid(packet);
        if (pid === 0) {
          return "pat";
        } else if (pid === pmtPid) {
          return "pmt";
        } else if (pmtPid) {
          return "pes";
        }
        return null;
      }, "parseType");
      var parsePat = /* @__PURE__ */ __name(function parsePat2(packet) {
        var pusi = parsePayloadUnitStartIndicator(packet);
        var offset = 4 + parseAdaptionField(packet);
        if (pusi) {
          offset += packet[offset] + 1;
        }
        return (packet[offset + 10] & 31) << 8 | packet[offset + 11];
      }, "parsePat");
      var parsePmt = /* @__PURE__ */ __name(function parsePmt2(packet) {
        var programMapTable = {};
        var pusi = parsePayloadUnitStartIndicator(packet);
        var payloadOffset = 4 + parseAdaptionField(packet);
        if (pusi) {
          payloadOffset += packet[payloadOffset] + 1;
        }
        if (!(packet[payloadOffset + 5] & 1)) {
          return;
        }
        var sectionLength, tableEnd, programInfoLength;
        sectionLength = (packet[payloadOffset + 1] & 15) << 8 | packet[payloadOffset + 2];
        tableEnd = 3 + sectionLength - 4;
        programInfoLength = (packet[payloadOffset + 10] & 15) << 8 | packet[payloadOffset + 11];
        var offset = 12 + programInfoLength;
        while (offset < tableEnd) {
          var i = payloadOffset + offset;
          programMapTable[(packet[i + 1] & 31) << 8 | packet[i + 2]] = packet[i];
          offset += ((packet[i + 3] & 15) << 8 | packet[i + 4]) + 5;
        }
        return programMapTable;
      }, "parsePmt");
      var parsePesType = /* @__PURE__ */ __name(function parsePesType2(packet, programMapTable) {
        var pid = parsePid(packet);
        var type2 = programMapTable[pid];
        switch (type2) {
          case streamTypes.H264_STREAM_TYPE:
            return "video";
          case streamTypes.ADTS_STREAM_TYPE:
            return "audio";
          case streamTypes.METADATA_STREAM_TYPE:
            return "timed-metadata";
          default:
            return null;
        }
      }, "parsePesType");
      var parsePesTime = /* @__PURE__ */ __name(function parsePesTime2(packet) {
        var pusi = parsePayloadUnitStartIndicator(packet);
        if (!pusi) {
          return null;
        }
        var offset = 4 + parseAdaptionField(packet);
        if (offset >= packet.byteLength) {
          return null;
        }
        var pes = null;
        var ptsDtsFlags;
        ptsDtsFlags = packet[offset + 7];
        if (ptsDtsFlags & 192) {
          pes = {};
          pes.pts = (packet[offset + 9] & 14) << 27 | (packet[offset + 10] & 255) << 20 | (packet[offset + 11] & 254) << 12 | (packet[offset + 12] & 255) << 5 | (packet[offset + 13] & 254) >>> 3;
          pes.pts *= 4;
          pes.pts += (packet[offset + 13] & 6) >>> 1;
          pes.dts = pes.pts;
          if (ptsDtsFlags & 64) {
            pes.dts = (packet[offset + 14] & 14) << 27 | (packet[offset + 15] & 255) << 20 | (packet[offset + 16] & 254) << 12 | (packet[offset + 17] & 255) << 5 | (packet[offset + 18] & 254) >>> 3;
            pes.dts *= 4;
            pes.dts += (packet[offset + 18] & 6) >>> 1;
          }
        }
        return pes;
      }, "parsePesTime");
      var parseNalUnitType = /* @__PURE__ */ __name(function parseNalUnitType2(type2) {
        switch (type2) {
          case 5:
            return "slice_layer_without_partitioning_rbsp_idr";
          case 6:
            return "sei_rbsp";
          case 7:
            return "seq_parameter_set_rbsp";
          case 8:
            return "pic_parameter_set_rbsp";
          case 9:
            return "access_unit_delimiter_rbsp";
          default:
            return null;
        }
      }, "parseNalUnitType");
      var videoPacketContainsKeyFrame = /* @__PURE__ */ __name(function videoPacketContainsKeyFrame2(packet) {
        var offset = 4 + parseAdaptionField(packet);
        var frameBuffer = packet.subarray(offset);
        var frameI = 0;
        var frameSyncPoint = 0;
        var foundKeyFrame = false;
        var nalType;
        for (; frameSyncPoint < frameBuffer.byteLength - 3; frameSyncPoint++) {
          if (frameBuffer[frameSyncPoint + 2] === 1) {
            frameI = frameSyncPoint + 5;
            break;
          }
        }
        while (frameI < frameBuffer.byteLength) {
          switch (frameBuffer[frameI]) {
            case 0:
              if (frameBuffer[frameI - 1] !== 0) {
                frameI += 2;
                break;
              } else if (frameBuffer[frameI - 2] !== 0) {
                frameI++;
                break;
              }
              if (frameSyncPoint + 3 !== frameI - 2) {
                nalType = parseNalUnitType(frameBuffer[frameSyncPoint + 3] & 31);
                if (nalType === "slice_layer_without_partitioning_rbsp_idr") {
                  foundKeyFrame = true;
                }
              }
              do {
                frameI++;
              } while (frameBuffer[frameI] !== 1 && frameI < frameBuffer.length);
              frameSyncPoint = frameI - 2;
              frameI += 3;
              break;
            case 1:
              if (frameBuffer[frameI - 1] !== 0 || frameBuffer[frameI - 2] !== 0) {
                frameI += 3;
                break;
              }
              nalType = parseNalUnitType(frameBuffer[frameSyncPoint + 3] & 31);
              if (nalType === "slice_layer_without_partitioning_rbsp_idr") {
                foundKeyFrame = true;
              }
              frameSyncPoint = frameI - 2;
              frameI += 3;
              break;
            default:
              frameI += 3;
              break;
          }
        }
        frameBuffer = frameBuffer.subarray(frameSyncPoint);
        frameI -= frameSyncPoint;
        frameSyncPoint = 0;
        if (frameBuffer && frameBuffer.byteLength > 3) {
          nalType = parseNalUnitType(frameBuffer[frameSyncPoint + 3] & 31);
          if (nalType === "slice_layer_without_partitioning_rbsp_idr") {
            foundKeyFrame = true;
          }
        }
        return foundKeyFrame;
      }, "videoPacketContainsKeyFrame");
      var probe$1 = {
        parseType,
        parsePat,
        parsePmt,
        parsePayloadUnitStartIndicator,
        parsePesType,
        parsePesTime,
        videoPacketContainsKeyFrame
      };
      var handleRollover = timestampRolloverStream.handleRollover;
      var probe = {};
      probe.ts = probe$1;
      probe.aac = utils;
      var ONE_SECOND_IN_TS = clock.ONE_SECOND_IN_TS;
      var MP2T_PACKET_LENGTH = 188, SYNC_BYTE = 71;
      var parsePsi_ = /* @__PURE__ */ __name(function parsePsi_2(bytes, pmt) {
        var startIndex = 0, endIndex = MP2T_PACKET_LENGTH, packet, type2;
        while (endIndex < bytes.byteLength) {
          if (bytes[startIndex] === SYNC_BYTE && bytes[endIndex] === SYNC_BYTE) {
            packet = bytes.subarray(startIndex, endIndex);
            type2 = probe.ts.parseType(packet, pmt.pid);
            switch (type2) {
              case "pat":
                pmt.pid = probe.ts.parsePat(packet);
                break;
              case "pmt":
                var table = probe.ts.parsePmt(packet);
                pmt.table = pmt.table || {};
                Object.keys(table).forEach(function(key) {
                  pmt.table[key] = table[key];
                });
                break;
            }
            startIndex += MP2T_PACKET_LENGTH;
            endIndex += MP2T_PACKET_LENGTH;
            continue;
          }
          startIndex++;
          endIndex++;
        }
      }, "parsePsi_");
      var parseAudioPes_ = /* @__PURE__ */ __name(function parseAudioPes_2(bytes, pmt, result) {
        var startIndex = 0, endIndex = MP2T_PACKET_LENGTH, packet, type2, pesType, pusi, parsed;
        var endLoop = false;
        while (endIndex <= bytes.byteLength) {
          if (bytes[startIndex] === SYNC_BYTE && (bytes[endIndex] === SYNC_BYTE || endIndex === bytes.byteLength)) {
            packet = bytes.subarray(startIndex, endIndex);
            type2 = probe.ts.parseType(packet, pmt.pid);
            switch (type2) {
              case "pes":
                pesType = probe.ts.parsePesType(packet, pmt.table);
                pusi = probe.ts.parsePayloadUnitStartIndicator(packet);
                if (pesType === "audio" && pusi) {
                  parsed = probe.ts.parsePesTime(packet);
                  if (parsed) {
                    parsed.type = "audio";
                    result.audio.push(parsed);
                    endLoop = true;
                  }
                }
                break;
            }
            if (endLoop) {
              break;
            }
            startIndex += MP2T_PACKET_LENGTH;
            endIndex += MP2T_PACKET_LENGTH;
            continue;
          }
          startIndex++;
          endIndex++;
        }
        endIndex = bytes.byteLength;
        startIndex = endIndex - MP2T_PACKET_LENGTH;
        endLoop = false;
        while (startIndex >= 0) {
          if (bytes[startIndex] === SYNC_BYTE && (bytes[endIndex] === SYNC_BYTE || endIndex === bytes.byteLength)) {
            packet = bytes.subarray(startIndex, endIndex);
            type2 = probe.ts.parseType(packet, pmt.pid);
            switch (type2) {
              case "pes":
                pesType = probe.ts.parsePesType(packet, pmt.table);
                pusi = probe.ts.parsePayloadUnitStartIndicator(packet);
                if (pesType === "audio" && pusi) {
                  parsed = probe.ts.parsePesTime(packet);
                  if (parsed) {
                    parsed.type = "audio";
                    result.audio.push(parsed);
                    endLoop = true;
                  }
                }
                break;
            }
            if (endLoop) {
              break;
            }
            startIndex -= MP2T_PACKET_LENGTH;
            endIndex -= MP2T_PACKET_LENGTH;
            continue;
          }
          startIndex--;
          endIndex--;
        }
      }, "parseAudioPes_");
      var parseVideoPes_ = /* @__PURE__ */ __name(function parseVideoPes_2(bytes, pmt, result) {
        var startIndex = 0, endIndex = MP2T_PACKET_LENGTH, packet, type2, pesType, pusi, parsed, frame, i, pes;
        var endLoop = false;
        var currentFrame = {
          data: [],
          size: 0
        };
        while (endIndex < bytes.byteLength) {
          if (bytes[startIndex] === SYNC_BYTE && bytes[endIndex] === SYNC_BYTE) {
            packet = bytes.subarray(startIndex, endIndex);
            type2 = probe.ts.parseType(packet, pmt.pid);
            switch (type2) {
              case "pes":
                pesType = probe.ts.parsePesType(packet, pmt.table);
                pusi = probe.ts.parsePayloadUnitStartIndicator(packet);
                if (pesType === "video") {
                  if (pusi && !endLoop) {
                    parsed = probe.ts.parsePesTime(packet);
                    if (parsed) {
                      parsed.type = "video";
                      result.video.push(parsed);
                      endLoop = true;
                    }
                  }
                  if (!result.firstKeyFrame) {
                    if (pusi) {
                      if (currentFrame.size !== 0) {
                        frame = new Uint8Array(currentFrame.size);
                        i = 0;
                        while (currentFrame.data.length) {
                          pes = currentFrame.data.shift();
                          frame.set(pes, i);
                          i += pes.byteLength;
                        }
                        if (probe.ts.videoPacketContainsKeyFrame(frame)) {
                          var firstKeyFrame = probe.ts.parsePesTime(frame);
                          if (firstKeyFrame) {
                            result.firstKeyFrame = firstKeyFrame;
                            result.firstKeyFrame.type = "video";
                          } else {
                            console.warn("Failed to extract PTS/DTS from PES at first keyframe. This could be an unusual TS segment, or else mux.js did not parse your TS segment correctly. If you know your TS segments do contain PTS/DTS on keyframes please file a bug report! You can try ffprobe to double check for yourself.");
                          }
                        }
                        currentFrame.size = 0;
                      }
                    }
                    currentFrame.data.push(packet);
                    currentFrame.size += packet.byteLength;
                  }
                }
                break;
            }
            if (endLoop && result.firstKeyFrame) {
              break;
            }
            startIndex += MP2T_PACKET_LENGTH;
            endIndex += MP2T_PACKET_LENGTH;
            continue;
          }
          startIndex++;
          endIndex++;
        }
        endIndex = bytes.byteLength;
        startIndex = endIndex - MP2T_PACKET_LENGTH;
        endLoop = false;
        while (startIndex >= 0) {
          if (bytes[startIndex] === SYNC_BYTE && bytes[endIndex] === SYNC_BYTE) {
            packet = bytes.subarray(startIndex, endIndex);
            type2 = probe.ts.parseType(packet, pmt.pid);
            switch (type2) {
              case "pes":
                pesType = probe.ts.parsePesType(packet, pmt.table);
                pusi = probe.ts.parsePayloadUnitStartIndicator(packet);
                if (pesType === "video" && pusi) {
                  parsed = probe.ts.parsePesTime(packet);
                  if (parsed) {
                    parsed.type = "video";
                    result.video.push(parsed);
                    endLoop = true;
                  }
                }
                break;
            }
            if (endLoop) {
              break;
            }
            startIndex -= MP2T_PACKET_LENGTH;
            endIndex -= MP2T_PACKET_LENGTH;
            continue;
          }
          startIndex--;
          endIndex--;
        }
      }, "parseVideoPes_");
      var adjustTimestamp_ = /* @__PURE__ */ __name(function adjustTimestamp_2(segmentInfo, baseTimestamp) {
        if (segmentInfo.audio && segmentInfo.audio.length) {
          var audioBaseTimestamp = baseTimestamp;
          if (typeof audioBaseTimestamp === "undefined" || isNaN(audioBaseTimestamp)) {
            audioBaseTimestamp = segmentInfo.audio[0].dts;
          }
          segmentInfo.audio.forEach(function(info) {
            info.dts = handleRollover(info.dts, audioBaseTimestamp);
            info.pts = handleRollover(info.pts, audioBaseTimestamp);
            info.dtsTime = info.dts / ONE_SECOND_IN_TS;
            info.ptsTime = info.pts / ONE_SECOND_IN_TS;
          });
        }
        if (segmentInfo.video && segmentInfo.video.length) {
          var videoBaseTimestamp = baseTimestamp;
          if (typeof videoBaseTimestamp === "undefined" || isNaN(videoBaseTimestamp)) {
            videoBaseTimestamp = segmentInfo.video[0].dts;
          }
          segmentInfo.video.forEach(function(info) {
            info.dts = handleRollover(info.dts, videoBaseTimestamp);
            info.pts = handleRollover(info.pts, videoBaseTimestamp);
            info.dtsTime = info.dts / ONE_SECOND_IN_TS;
            info.ptsTime = info.pts / ONE_SECOND_IN_TS;
          });
          if (segmentInfo.firstKeyFrame) {
            var frame = segmentInfo.firstKeyFrame;
            frame.dts = handleRollover(frame.dts, videoBaseTimestamp);
            frame.pts = handleRollover(frame.pts, videoBaseTimestamp);
            frame.dtsTime = frame.dts / ONE_SECOND_IN_TS;
            frame.ptsTime = frame.pts / ONE_SECOND_IN_TS;
          }
        }
      }, "adjustTimestamp_");
      var inspectAac_ = /* @__PURE__ */ __name(function inspectAac_2(bytes) {
        var endLoop = false, audioCount = 0, sampleRate = null, timestamp = null, frameSize = 0, byteIndex = 0, packet;
        while (bytes.length - byteIndex >= 3) {
          var type2 = probe.aac.parseType(bytes, byteIndex);
          switch (type2) {
            case "timed-metadata":
              if (bytes.length - byteIndex < 10) {
                endLoop = true;
                break;
              }
              frameSize = probe.aac.parseId3TagSize(bytes, byteIndex);
              if (frameSize > bytes.length) {
                endLoop = true;
                break;
              }
              if (timestamp === null) {
                packet = bytes.subarray(byteIndex, byteIndex + frameSize);
                timestamp = probe.aac.parseAacTimestamp(packet);
              }
              byteIndex += frameSize;
              break;
            case "audio":
              if (bytes.length - byteIndex < 7) {
                endLoop = true;
                break;
              }
              frameSize = probe.aac.parseAdtsSize(bytes, byteIndex);
              if (frameSize > bytes.length) {
                endLoop = true;
                break;
              }
              if (sampleRate === null) {
                packet = bytes.subarray(byteIndex, byteIndex + frameSize);
                sampleRate = probe.aac.parseSampleRate(packet);
              }
              audioCount++;
              byteIndex += frameSize;
              break;
            default:
              byteIndex++;
              break;
          }
          if (endLoop) {
            return null;
          }
        }
        if (sampleRate === null || timestamp === null) {
          return null;
        }
        var audioTimescale = ONE_SECOND_IN_TS / sampleRate;
        var result = {
          audio: [{
            type: "audio",
            dts: timestamp,
            pts: timestamp
          }, {
            type: "audio",
            dts: timestamp + audioCount * 1024 * audioTimescale,
            pts: timestamp + audioCount * 1024 * audioTimescale
          }]
        };
        return result;
      }, "inspectAac_");
      var inspectTs_ = /* @__PURE__ */ __name(function inspectTs_2(bytes) {
        var pmt = {
          pid: null,
          table: null
        };
        var result = {};
        parsePsi_(bytes, pmt);
        for (var pid in pmt.table) {
          if (pmt.table.hasOwnProperty(pid)) {
            var type2 = pmt.table[pid];
            switch (type2) {
              case streamTypes.H264_STREAM_TYPE:
                result.video = [];
                parseVideoPes_(bytes, pmt, result);
                if (result.video.length === 0) {
                  delete result.video;
                }
                break;
              case streamTypes.ADTS_STREAM_TYPE:
                result.audio = [];
                parseAudioPes_(bytes, pmt, result);
                if (result.audio.length === 0) {
                  delete result.audio;
                }
                break;
            }
          }
        }
        return result;
      }, "inspectTs_");
      var inspect = /* @__PURE__ */ __name(function inspect2(bytes, baseTimestamp) {
        var isAacData = probe.aac.isLikelyAacData(bytes);
        var result;
        if (isAacData) {
          result = inspectAac_(bytes);
        } else {
          result = inspectTs_(bytes);
        }
        if (!result || !result.audio && !result.video) {
          return null;
        }
        adjustTimestamp_(result, baseTimestamp);
        return result;
      }, "inspect");
      var tsInspector = {
        inspect,
        parseAudioPes_
      };
      var muxjs2 = {
        codecs,
        mp4,
        flv,
        mp2t: m2ts,
        partial
      };
      muxjs2.mp4.tools = mp4Inspector;
      muxjs2.flv.tools = flvInspector;
      muxjs2.mp2t.tools = tsInspector;
      var lib = muxjs2;
      return lib;
    }));
  }
});

// src/db.ts
function requireRelayDb(env) {
  if (!env.RELAY_DB) {
    throw new Error(
      "D1 binding RELAY_DB is missing. Create/bind the database and apply migrations before using media persistence."
    );
  }
  return env.RELAY_DB;
}
__name(requireRelayDb, "requireRelayDb");
async function resolveMediaIdentity(input) {
  const provider = normalizeProvider(input.provider, input.sourceUrl || input.pageUrl || input.mediaUrl || "");
  const canonicalUrl = canonicalizeIdentityUrl(input.sourceUrl || input.pageUrl || input.mediaUrl || "");
  const explicitKey = normalizeExplicitMediaKey(input.mediaKey, provider);
  if (explicitKey) {
    const separator = explicitKey.indexOf(":");
    const explicitProvider = separator > 0 ? explicitKey.slice(0, separator) : provider;
    const explicitId = separator > 0 ? explicitKey.slice(separator + 1) : explicitKey;
    const normalizedProvider = normalizeProviderKey(explicitProvider) || provider;
    const providerMediaId2 = normalizeOpaqueMediaId(explicitId) || explicitKey;
    const key2 = `${normalizedProvider}:${providerMediaId2}`;
    const legacyKey2 = legacyNormalizeKeyPart(input.mediaKey);
    return {
      key: key2,
      provider: normalizedProvider,
      providerMediaId: providerMediaId2,
      canonicalUrl,
      legacyKeys: legacyKey2 && legacyKey2 !== key2 ? [legacyKey2] : []
    };
  }
  const explicitMediaId = normalizeOpaqueMediaId(input.mediaId);
  const extractedMediaId = extractProviderMediaId(provider, canonicalUrl);
  const providerMediaId = explicitMediaId || extractedMediaId || await shortSha256(canonicalUrl);
  const key = `${provider}:${providerMediaId}`;
  const legacyId = legacyNormalizeKeyPart(providerMediaId);
  const legacyKey = legacyId ? `${provider}:${legacyId}` : "";
  return {
    key,
    provider,
    providerMediaId,
    canonicalUrl,
    legacyKeys: legacyKey && legacyKey !== key ? [legacyKey] : []
  };
}
__name(resolveMediaIdentity, "resolveMediaIdentity");
function identityLookupKeys(identity) {
  if (typeof identity === "string") return [identity].filter(Boolean);
  return [...new Set([identity.key, ...identity.legacyKeys || []].filter(Boolean))];
}
__name(identityLookupKeys, "identityLookupKeys");
async function resolveStoredMediaIdentity(db, identity) {
  const keys = identityLookupKeys(identity);
  if (keys.length <= 1) return identity;
  const row = await db.prepare(
    `SELECT media_key FROM media
     WHERE media_key IN (SELECT CAST(value AS TEXT) FROM json_each(?1))
     ORDER BY CASE WHEN media_key = ?2 THEN 0 ELSE 1 END
     LIMIT 1`
  ).bind(JSON.stringify(keys), identity.key).first();
  const storedKey = String(row?.media_key || "");
  if (!storedKey || storedKey === identity.key) return identity;
  return {
    ...identity,
    key: storedKey,
    legacyKeys: [...new Set([identity.key, ...identity.legacyKeys].filter((key) => key && key !== storedKey))]
  };
}
__name(resolveStoredMediaIdentity, "resolveStoredMediaIdentity");
async function checkStoredMediaDeliveries(db, identities, channels = []) {
  const uniqueIdentities = [...new Map(identities.map((identity) => [identity.key, identity])).values()];
  if (!uniqueIdentities.length) return /* @__PURE__ */ new Map();
  const lookupKeys = [...new Set(uniqueIdentities.flatMap(identityLookupKeys))];
  const requestedChannels = [...new Set(channels.map((channel) => channel.trim()).filter(Boolean))];
  const channelJoin = requestedChannels.length ? " AND d.channel_id IN (SELECT CAST(value AS TEXT) FROM json_each(?2))" : "";
  const statement = db.prepare(
    `SELECT
      m.media_key, m.provider, m.provider_media_id, m.canonical_url,
      m.source_url, m.page_url, m.media_type, m.media_count,
      m.metadata_json, m.first_seen_at, m.updated_at,
      d.channel_id, d.telegram_chat_id, d.telegram_chat_title,
      d.first_message_ids_json, d.last_message_ids_json,
      d.send_count, d.first_sent_at, d.last_sent_at
     FROM media AS m
     LEFT JOIN media_deliveries AS d
       ON d.media_key = m.media_key${channelJoin}
     WHERE m.media_key IN (SELECT CAST(value AS TEXT) FROM json_each(?1))`
  );
  const result = requestedChannels.length ? await statement.bind(JSON.stringify(lookupKeys), JSON.stringify(requestedChannels)).all() : await statement.bind(JSON.stringify(lookupKeys)).all();
  const byStoredKey = /* @__PURE__ */ new Map();
  for (const row of result.results || []) {
    let record = byStoredKey.get(row.media_key);
    if (!record) {
      record = { media: formatMediaRow(row), deliveries: [] };
      byStoredKey.set(row.media_key, record);
    }
    if (row.channel_id) {
      record.deliveries.push(formatDeliveryRow({
        channel_id: row.channel_id,
        telegram_chat_id: row.telegram_chat_id ?? null,
        telegram_chat_title: row.telegram_chat_title ?? null,
        first_message_ids_json: row.first_message_ids_json ?? "[]",
        last_message_ids_json: row.last_message_ids_json ?? "[]",
        send_count: row.send_count ?? 1,
        first_sent_at: row.first_sent_at ?? "",
        last_sent_at: row.last_sent_at ?? ""
      }));
    }
  }
  const records = /* @__PURE__ */ new Map();
  for (const identity of uniqueIdentities) {
    const matches = identityLookupKeys(identity).map((key) => byStoredKey.get(key)).filter((record) => Boolean(record));
    if (!matches.length) continue;
    const preferred = matches.find((record) => record.media.key === identity.key) || matches[0];
    const deliveriesByChannel = /* @__PURE__ */ new Map();
    for (const match of matches) {
      for (const delivery of match.deliveries) {
        const previous = deliveriesByChannel.get(delivery.channelId);
        if (!previous) {
          deliveriesByChannel.set(delivery.channelId, delivery);
          continue;
        }
        const previousLast = Date.parse(previous.lastSentAt || "") || 0;
        const nextLast = Date.parse(delivery.lastSentAt || "") || 0;
        const newer = nextLast >= previousLast ? delivery : previous;
        const firstSentAt = [previous.firstSentAt, delivery.firstSentAt].filter(Boolean).sort()[0] || newer.firstSentAt;
        const lastSentAt = [previous.lastSentAt, delivery.lastSentAt].filter(Boolean).sort().at(-1) || newer.lastSentAt;
        deliveriesByChannel.set(delivery.channelId, {
          ...newer,
          sendCount: Math.max(0, Number(previous.sendCount || 0)) + Math.max(0, Number(delivery.sendCount || 0)),
          firstSentAt,
          lastSentAt
        });
      }
    }
    records.set(identity.key, {
      media: preferred.media,
      deliveries: [...deliveriesByChannel.values()].sort((a, b) => String(b.lastSentAt).localeCompare(String(a.lastSentAt)))
    });
  }
  return records;
}
__name(checkStoredMediaDeliveries, "checkStoredMediaDeliveries");
async function acquireDeliveryClaims(db, identity, channels, options = {}) {
  const requested = [...new Set(channels.map((channel) => channel.trim()).filter(Boolean))];
  const requestId = options.requestId || crypto.randomUUID();
  if (!requested.length) return { requestId, requested: [], acquired: [], alreadySent: [], inProgress: [], queryCount: 0 };
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + Math.max(3e4, options.ttlMs || 30 * 6e4)).toISOString();
  const lookupKeys = identityLookupKeys(identity);
  const results = await db.batch([
    db.prepare("DELETE FROM delivery_claims WHERE expires_at <= ?1").bind(now),
    db.prepare(
      `INSERT OR IGNORE INTO delivery_claims (media_key, channel_id, request_id, claimed_at, expires_at)
       SELECT ?1, CAST(c.value AS TEXT), ?2, ?3, ?4
       FROM json_each(?5) AS c
       WHERE NOT EXISTS (
         SELECT 1 FROM media_deliveries d
         WHERE d.media_key IN (SELECT CAST(value AS TEXT) FROM json_each(?6))
           AND d.channel_id = CAST(c.value AS TEXT)
       )`
    ).bind(identity.key, requestId, now, expiresAt, JSON.stringify(requested), JSON.stringify(lookupKeys)),
    db.prepare(
      `SELECT channel_id, request_id FROM delivery_claims
       WHERE media_key = ?1
         AND channel_id IN (SELECT CAST(value AS TEXT) FROM json_each(?2))`
    ).bind(identity.key, JSON.stringify(requested)),
    db.prepare(
      `SELECT DISTINCT channel_id FROM media_deliveries
       WHERE media_key IN (SELECT CAST(value AS TEXT) FROM json_each(?1))
         AND channel_id IN (SELECT CAST(value AS TEXT) FROM json_each(?2))`
    ).bind(JSON.stringify(lookupKeys), JSON.stringify(requested))
  ]);
  const claimRows = results[2]?.results || [];
  const deliveredRows = results[3]?.results || [];
  const alreadySent = new Set(deliveredRows.map((row) => row.channel_id));
  const acquired = new Set(claimRows.filter((row) => row.request_id === requestId).map((row) => row.channel_id));
  const inProgress = requested.filter((channelId) => !alreadySent.has(channelId) && !acquired.has(channelId));
  return {
    requestId,
    requested,
    acquired: requested.filter((channelId) => acquired.has(channelId)),
    alreadySent: requested.filter((channelId) => alreadySent.has(channelId)),
    inProgress,
    queryCount: 4
  };
}
__name(acquireDeliveryClaims, "acquireDeliveryClaims");
async function releaseDeliveryClaims(db, identity, requestId, channels) {
  const key = typeof identity === "string" ? identity : identity.key;
  const requested = [...new Set((channels || []).map((channel) => channel.trim()).filter(Boolean))];
  if (requested.length) {
    await db.prepare(
      `DELETE FROM delivery_claims
       WHERE media_key = ?1 AND request_id = ?2
         AND channel_id IN (SELECT CAST(value AS TEXT) FROM json_each(?3))`
    ).bind(key, requestId, JSON.stringify(requested)).run();
    return;
  }
  await db.prepare("DELETE FROM delivery_claims WHERE media_key = ?1 AND request_id = ?2").bind(key, requestId).run();
}
__name(releaseDeliveryClaims, "releaseDeliveryClaims");
async function persistSuccessfulDeliveries(db, input) {
  if (!input.deliveries.length) return [];
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
  const statements = [
    db.prepare(
      `INSERT INTO media (
        media_key, provider, provider_media_id, canonical_url, source_url, page_url,
        media_type, media_count, metadata_json, first_seen_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(media_key) DO UPDATE SET
        canonical_url = excluded.canonical_url,
        source_url = COALESCE(excluded.source_url, media.source_url),
        page_url = COALESCE(excluded.page_url, media.page_url),
        media_type = excluded.media_type,
        media_count = excluded.media_count,
        metadata_json = COALESCE(excluded.metadata_json, media.metadata_json),
        updated_at = excluded.updated_at`
    ).bind(
      input.identity.key,
      input.identity.provider,
      input.identity.providerMediaId,
      input.identity.canonicalUrl,
      input.sourceUrl,
      input.pageUrl,
      input.mediaType,
      input.mediaCount,
      metadataJson,
      now,
      now
    )
  ];
  for (const delivery of input.deliveries) {
    const messageIds = JSON.stringify(delivery.messageIds.filter((id) => typeof id === "number"));
    statements.push(
      db.prepare(
        `INSERT INTO media_deliveries (
          media_key, channel_id, telegram_chat_id, telegram_chat_title,
          first_message_ids_json, last_message_ids_json, send_count, first_sent_at, last_sent_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(media_key, channel_id) DO UPDATE SET
          telegram_chat_id = excluded.telegram_chat_id,
          telegram_chat_title = COALESCE(excluded.telegram_chat_title, media_deliveries.telegram_chat_title),
          last_message_ids_json = excluded.last_message_ids_json,
          send_count = media_deliveries.send_count + 1,
          last_sent_at = excluded.last_sent_at`
      ).bind(
        input.identity.key,
        delivery.requestedChatId,
        delivery.telegramChatId == null ? null : String(delivery.telegramChatId),
        delivery.telegramChatTitle,
        messageIds,
        messageIds,
        now,
        now
      )
    );
  }
  await db.batch(statements);
  return input.deliveries.map((delivery) => delivery.requestedChatId);
}
__name(persistSuccessfulDeliveries, "persistSuccessfulDeliveries");
async function getStoredMedia(db, mediaKey) {
  const rawKey = normalizeOpaqueMediaId(mediaKey);
  const legacyKey = legacyNormalizeKeyPart(rawKey);
  const keys = [...new Set([rawKey, legacyKey].filter(Boolean))];
  const media = await db.prepare(
    `SELECT * FROM media
       WHERE media_key IN (SELECT CAST(value AS TEXT) FROM json_each(?1))
       ORDER BY CASE WHEN media_key = ?2 THEN 0 ELSE 1 END
       LIMIT 1`
  ).bind(JSON.stringify(keys), rawKey).first();
  if (!media) return null;
  const deliveries = await db.prepare("SELECT * FROM media_deliveries WHERE media_key = ? ORDER BY last_sent_at DESC").bind(media.media_key).all();
  return { media: formatMediaRow(media), deliveries: (deliveries.results || []).map(formatDeliveryRow) };
}
__name(getStoredMedia, "getStoredMedia");
async function findStoredMedia(db, options) {
  const conditions = [];
  const values = [];
  if (options.provider) {
    conditions.push("provider = ?");
    values.push(normalizeProviderKey(options.provider));
  }
  if (options.mediaId) {
    const opaqueId = normalizeOpaqueMediaId(options.mediaId);
    const legacyId = legacyNormalizeKeyPart(opaqueId);
    if (legacyId && legacyId !== opaqueId) {
      conditions.push("provider_media_id IN (?, ?)");
      values.push(opaqueId, legacyId);
    } else {
      conditions.push("provider_media_id = ?");
      values.push(opaqueId);
    }
  }
  if (options.sourceUrl) {
    conditions.push("canonical_url = ?");
    values.push(canonicalizeIdentityUrl(options.sourceUrl));
  }
  const limit = Math.min(100, Math.max(1, options.limit || 25));
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await db.prepare(
    `SELECT m.*,
      (SELECT COUNT(*) FROM media_deliveries d WHERE d.media_key = m.media_key) AS channel_count,
      (SELECT COALESCE(SUM(send_count), 0) FROM media_deliveries d WHERE d.media_key = m.media_key) AS send_count
     FROM media m ${where}
     ORDER BY updated_at DESC LIMIT ?`
  ).bind(...values, limit).all();
  return (result.results || []).map((row) => ({ ...formatMediaRow(row), channelCount: row.channel_count, sendCount: row.send_count }));
}
__name(findStoredMedia, "findStoredMedia");
function formatMediaRow(row) {
  return {
    key: row.media_key,
    provider: row.provider,
    mediaId: row.provider_media_id,
    canonicalUrl: row.canonical_url,
    sourceUrl: row.source_url,
    pageUrl: row.page_url,
    mediaType: row.media_type,
    mediaCount: row.media_count,
    metadata: parseJson(row.metadata_json),
    firstSeenAt: row.first_seen_at,
    updatedAt: row.updated_at
  };
}
__name(formatMediaRow, "formatMediaRow");
function formatDeliveryRow(row) {
  return {
    channelId: row.channel_id,
    telegramChatId: row.telegram_chat_id,
    telegramChatTitle: row.telegram_chat_title,
    firstMessageIds: parseJson(row.first_message_ids_json) || [],
    lastMessageIds: parseJson(row.last_message_ids_json) || [],
    sendCount: row.send_count,
    firstSentAt: row.first_sent_at,
    lastSentAt: row.last_sent_at
  };
}
__name(formatDeliveryRow, "formatDeliveryRow");
function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
__name(parseJson, "parseJson");
function normalizeProvider(value, url) {
  const explicit = normalizeProviderKey(value);
  if (explicit) return explicit;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === "x.com" || hostname.endsWith("twitter.com")) return "twitter";
    if (hostname.endsWith("instagram.com")) return "instagram";
    if (hostname.endsWith("tiktok.com")) return "tiktok";
    return normalizeProviderKey(hostname.replace(/^www\./, "")) || "generic";
  } catch {
    return "generic";
  }
}
__name(normalizeProvider, "normalizeProvider");
function extractProviderMediaId(provider, url) {
  try {
    const parsed = new URL(url);
    if (provider === "twitter" || provider === "x") {
      return parsed.pathname.match(/\/status\/(\d+)/i)?.[1] || null;
    }
    if (provider === "instagram") {
      return normalizeOpaqueMediaId(parsed.pathname.match(/\/(?:p|reel|reels|tv)\/([^/?#]+)/i)?.[1] || null);
    }
    if (provider === "tiktok") {
      return parsed.pathname.match(/\/(?:video|photo)\/(\d+)/i)?.[1] || null;
    }
  } catch {
  }
  return null;
}
__name(extractProviderMediaId, "extractProviderMediaId");
function canonicalizeIdentityUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    const removable = [];
    url.searchParams.forEach((_value, key) => {
      if (/^(utm_|fbclid$|gclid$|igshid$|si$|s$|t$)/i.test(key)) removable.push(key);
    });
    for (const key of removable) url.searchParams.delete(key);
    if (url.protocol === "https:" && url.port === "443" || url.protocol === "http:" && url.port === "80") url.port = "";
    url.hostname = url.hostname.toLowerCase();
    return url.href;
  } catch {
    return value.trim();
  }
}
__name(canonicalizeIdentityUrl, "canonicalizeIdentityUrl");
function normalizeProviderKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._@-]+/g, "-").slice(0, 120);
}
__name(normalizeProviderKey, "normalizeProviderKey");
function normalizeOpaqueMediaId(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 512);
}
__name(normalizeOpaqueMediaId, "normalizeOpaqueMediaId");
function normalizeExplicitMediaKey(value, fallbackProvider) {
  const raw = normalizeOpaqueMediaId(value);
  if (!raw) return "";
  const separator = raw.indexOf(":");
  if (separator <= 0) return `${fallbackProvider}:${raw}`;
  const provider = normalizeProviderKey(raw.slice(0, separator)) || fallbackProvider;
  const mediaId = normalizeOpaqueMediaId(raw.slice(separator + 1));
  return mediaId ? `${provider}:${mediaId}` : "";
}
__name(normalizeExplicitMediaKey, "normalizeExplicitMediaKey");
function legacyNormalizeKeyPart(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9._:@-]+/g, "-").slice(0, 240);
}
__name(legacyNormalizeKeyPart, "legacyNormalizeKeyPart");
async function shortSha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(shortSha256, "shortSha256");

// src/lib/http.ts
var MAX_REDIRECTS = 5;
function normalizePublicHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  if (isBlockedHostname(url.hostname)) {
    return null;
  }
  return url;
}
__name(normalizePublicHttpUrl, "normalizePublicHttpUrl");
function normalizeOptionalSourceUrl(value) {
  if (value == null || value === "") {
    return null;
  }
  const url = normalizePublicHttpUrl(String(value));
  return url?.href ?? null;
}
__name(normalizeOptionalSourceUrl, "normalizeOptionalSourceUrl");
function isBlockedHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  if (host === "::1" || host === "0:0:0:0:0:0:0:1" || host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb") || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) {
    return false;
  }
  const parts = ipv4.slice(1).map(Number);
  if (parts.some((part) => part < 0 || part > 255)) {
    return true;
  }
  const [a = 0, b = 0] = parts;
  return a === 0 || a === 10 || a === 100 && b >= 64 && b <= 127 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224;
}
__name(isBlockedHostname, "isBlockedHostname");
async function fetchPublic(input, init = {}) {
  let current = input instanceof URL ? normalizePublicHttpUrl(input.href) : normalizePublicHttpUrl(String(input));
  if (!current) {
    throw new Error("The requested URL is not a public HTTP(S) URL");
  }
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(current.href, {
      ...init,
      redirect: "manual"
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }
    const location = response.headers.get("location");
    if (!location) {
      return response;
    }
    const next = normalizePublicHttpUrl(new URL(location, current).href);
    if (!next) {
      throw new Error("A media redirect pointed to a blocked or invalid URL");
    }
    current = next;
  }
  throw new Error("Too many media redirects");
}
__name(fetchPublic, "fetchPublic");
function getBaseContentType(value) {
  return String(value || "").split(";", 1)[0]?.trim().toLowerCase() || "";
}
__name(getBaseContentType, "getBaseContentType");
function getFileExtension(value) {
  try {
    const pathname = new URL(value).pathname;
    const match = pathname.match(/\.([a-z0-9]{2,8})$/i);
    return match?.[1]?.toLowerCase() || "";
  } catch {
    return "";
  }
}
__name(getFileExtension, "getFileExtension");
function resolvePublicRelativeUrl(value, baseUrl) {
  try {
    return normalizePublicHttpUrl(new URL(value, baseUrl).href)?.href ?? null;
  } catch {
    return null;
  }
}
__name(resolvePublicRelativeUrl, "resolvePublicRelativeUrl");

// src/hls/decoder.ts
var HlsDecodeError = class extends Error {
  constructor(message, details = {}) {
    super(message);
    this.details = details;
    this.name = "HlsDecodeError";
  }
  static {
    __name(this, "HlsDecodeError");
  }
};
var HlsAes128Decoder = class {
  static {
    __name(this, "HlsAes128Decoder");
  }
  keyCache = /* @__PURE__ */ new Map();
  async decode(context) {
    const { key, encryptedBytes, mediaSequenceNumber, loadKey } = context;
    if (!key || key.method === "NONE") {
      return encryptedBytes;
    }
    if (key.method !== "AES-128") {
      throw new HlsDecodeError(
        `Unsupported HLS encryption method: ${key.method || "unknown"}`,
        {
          method: key.method,
          keyFormat: key.keyFormat
        }
      );
    }
    if (key.keyFormat && key.keyFormat !== "identity") {
      throw new HlsDecodeError(
        `Unsupported HLS KEYFORMAT for direct decryption: ${key.keyFormat}`,
        {
          keyFormat: key.keyFormat
        }
      );
    }
    if (!key.uri) {
      throw new HlsDecodeError("AES-128 EXT-X-KEY has no URI");
    }
    let keyBytes = this.keyCache.get(key.uri);
    if (!keyBytes) {
      keyBytes = await loadKey(key.uri);
      if (keyBytes.byteLength !== 16) {
        throw new HlsDecodeError(
          `AES-128 key must be exactly 16 bytes, got ${keyBytes.byteLength}`,
          {
            keyUri: key.uri
          }
        );
      }
      this.keyCache.set(key.uri, keyBytes);
    }
    const iv = key.iv || deriveHlsAes128Iv(mediaSequenceNumber);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      toWebCryptoArrayBuffer(keyBytes),
      { name: "AES-CBC" },
      false,
      ["decrypt"]
    );
    try {
      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-CBC",
          iv: toWebCryptoArrayBuffer(iv)
        },
        cryptoKey,
        toWebCryptoArrayBuffer(encryptedBytes)
      );
      return new Uint8Array(decrypted);
    } catch (error) {
      throw new HlsDecodeError(
        "Failed to decrypt AES-128 HLS media unit",
        {
          cause: error instanceof Error ? error.message : String(error),
          keyUri: key.uri,
          mediaSequenceNumber
        }
      );
    }
  }
};
function toWebCryptoArrayBuffer(bytes) {
  const { buffer, byteOffset, byteLength } = bytes;
  if (buffer instanceof ArrayBuffer) {
    if (byteOffset === 0 && byteLength === buffer.byteLength) return buffer;
    return buffer.slice(byteOffset, byteOffset + byteLength);
  }
  const copy = new Uint8Array(byteLength);
  copy.set(bytes);
  return copy.buffer;
}
__name(toWebCryptoArrayBuffer, "toWebCryptoArrayBuffer");
function deriveHlsAes128Iv(mediaSequenceNumber) {
  let value = BigInt(Math.max(0, mediaSequenceNumber));
  const iv = new Uint8Array(16);
  for (let index = 15; index >= 0 && value > 0n; index -= 1) {
    iv[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  return iv;
}
__name(deriveHlsAes128Iv, "deriveHlsAes128Iv");

// src/hls/downloader.ts
var HlsDownloadError = class extends Error {
  constructor(message, details = {}) {
    super(message);
    this.details = details;
    this.name = "HlsDownloadError";
  }
  static {
    __name(this, "HlsDownloadError");
  }
};
var MediaBudget = class {
  constructor(maximum) {
    this.maximum = maximum;
  }
  static {
    __name(this, "MediaBudget");
  }
  used = 0;
  add(byteLength) {
    this.used += byteLength;
    if (this.used > this.maximum) {
      throw new HlsDownloadError(
        `HLS media exceeds the configured in-memory limit of ${this.maximum} bytes`,
        {
          maximum: this.maximum,
          used: this.used
        }
      );
    }
  }
  get value() {
    return this.used;
  }
};
var HlsDownloader = class {
  static {
    __name(this, "HlsDownloader");
  }
  headers;
  concurrency;
  retries;
  retryDelayMs;
  maxMediaBytes;
  resourceCache = /* @__PURE__ */ new Map();
  decoder = new HlsAes128Decoder();
  constructor(options = {}) {
    this.headers = options.headers || {};
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.retries = Math.max(0, options.retries ?? 2);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 350);
    this.maxMediaBytes = Math.max(1e6, options.maxMediaBytes ?? 32e6);
  }
  async download(resolved, options = {}) {
    const budget = new MediaBudget(this.maxMediaBytes);
    const video = await this.downloadPlaylist(
      resolved.mediaPlaylist,
      "video",
      budget,
      options
    );
    const audio = resolved.audio ? await this.downloadPlaylist(
      resolved.audio.playlist,
      "audio",
      budget,
      options
    ) : null;
    return {
      resolved,
      video,
      audio,
      liveSnapshot: !resolved.mediaPlaylist.endList || Boolean(resolved.audio && !resolved.audio.playlist.endList)
    };
  }
  async downloadPlaylist(playlist, kind, budget, options) {
    const units = this.buildUnits(playlist);
    if (!units.length) {
      throw new HlsDownloadError("Media playlist contains no downloadable units", {
        url: playlist.url
      });
    }
    const mapCache = /* @__PURE__ */ new Map();
    const initSegments = [];
    const initIdentities = [];
    let completed = 0;
    let loadedBytes = 0;
    const mediaUnits = await this.mapConcurrent(
      units,
      this.concurrency,
      async (unit) => {
        options.signal?.throwIfAborted?.();
        if (unit.map?.uri) {
          const mapIdentity = this.resourceIdentity(unit.map.uri, unit.map.byteRange);
          if (!mapCache.has(mapIdentity)) {
            const mapBytes = await this.fetchResource(unit.map.uri, {
              byteRange: unit.map.byteRange,
              signal: options.signal,
              cache: true
            });
            mapCache.set(mapIdentity, mapBytes);
          }
        }
        let bytes = await this.fetchResource(unit.uri, {
          byteRange: unit.byteRange,
          signal: options.signal,
          cache: false
        });
        if (unit.key) {
          bytes = await this.decryptUnit(bytes, unit, options.signal);
        }
        budget.add(bytes.byteLength);
        loadedBytes += bytes.byteLength;
        completed += 1;
        options.onProgress?.({
          completed,
          total: units.length,
          loadedBytes,
          ratio: completed / units.length
        });
        return bytes;
      }
    );
    for (const unit of units) {
      if (!unit.map?.uri) {
        continue;
      }
      const identity = this.resourceIdentity(unit.map.uri, unit.map.byteRange);
      if (initIdentities.at(-1) === identity) {
        continue;
      }
      const bytes = mapCache.get(identity);
      if (bytes) {
        budget.add(bytes.byteLength);
        initSegments.push(bytes);
        initIdentities.push(identity);
      }
    }
    const container = detectContainer(
      initSegments[0] || mediaUnits[0] || new Uint8Array(),
      playlist
    );
    const mimeType = inferMimeType(container, kind);
    const extension = inferExtension(container, kind);
    return {
      kind,
      playlist,
      initSegments,
      mediaUnits,
      container,
      mimeType,
      extension,
      size: mediaUnits.reduce((sum, bytes) => sum + bytes.byteLength, 0) + initSegments.reduce((sum, bytes) => sum + bytes.byteLength, 0),
      encrypted: units.some((unit) => Boolean(unit.key)),
      segmentCount: mediaUnits.length,
      hasMultipleInitSegments: initSegments.length > 1
    };
  }
  buildUnits(playlist) {
    const segmentUnits = playlist.segments.filter((segment) => segment.uri && !segment.gap).map((segment) => this.segmentToUnit(segment));
    if (segmentUnits.length > 0) {
      return segmentUnits;
    }
    return playlist.trailingParts.filter((part) => part.uri && !part.gap).map((part, index) => this.partToUnit(
      part,
      playlist.mediaSequence + index
    ));
  }
  segmentToUnit(segment) {
    return {
      uri: segment.uri,
      byteRange: segment.byteRange,
      map: segment.map,
      key: this.selectDecryptableKey(segment.keys, segment.key),
      mediaSequenceNumber: segment.mediaSequenceNumber,
      gap: segment.gap
    };
  }
  partToUnit(part, mediaSequenceNumber) {
    return {
      uri: part.uri,
      byteRange: part.byteRange,
      map: null,
      key: null,
      mediaSequenceNumber,
      gap: part.gap
    };
  }
  selectDecryptableKey(keys, fallback) {
    const candidates = keys.length > 0 ? keys : fallback ? [fallback] : [];
    return candidates.find((key) => !key.keyFormat || key.keyFormat === "identity") || candidates[0] || null;
  }
  async decryptUnit(bytes, unit, signal) {
    if (!unit.key) {
      return bytes;
    }
    return this.decoder.decode({
      key: unit.key,
      encryptedBytes: bytes,
      mediaSequenceNumber: unit.mediaSequenceNumber,
      loadKey: /* @__PURE__ */ __name((uri) => {
        return this.fetchResource(uri, {
          signal,
          cache: true
        });
      }, "loadKey")
    });
  }
  async fetchResource(url, options) {
    const identity = this.resourceIdentity(url, options.byteRange || null);
    if (options.cache && this.resourceCache.has(identity)) {
      return await this.resourceCache.get(identity);
    }
    const promise = this.retry(async () => {
      const headers = new Headers(this.headers);
      const byteRange = options.byteRange;
      if (byteRange && byteRange.offset != null && Number.isFinite(byteRange.offset) && Number.isFinite(byteRange.length)) {
        headers.set(
          "Range",
          `bytes=${byteRange.offset}-${byteRange.offset + byteRange.length - 1}`
        );
      }
      const response = await fetchPublic(url, {
        method: "GET",
        headers,
        signal: options.signal
      });
      if (!response.ok && response.status !== 206) {
        throw new HlsDownloadError(
          `HTTP ${response.status} while downloading HLS resource`,
          {
            url
          }
        );
      }
      return new Uint8Array(await response.arrayBuffer());
    }, options.signal);
    if (options.cache) {
      this.resourceCache.set(identity, promise);
    }
    try {
      const bytes = await promise;
      if (options.cache) {
        this.resourceCache.set(identity, bytes);
      }
      return bytes;
    } catch (error) {
      if (options.cache) {
        this.resourceCache.delete(identity);
      }
      throw error;
    }
  }
  async retry(operation, signal) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      signal?.throwIfAborted?.();
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        if (attempt >= this.retries) {
          throw error;
        }
        await sleep(this.retryDelayMs * 2 ** attempt, signal);
      }
    }
    throw lastError;
  }
  resourceIdentity(url, byteRange) {
    return byteRange ? `${url}#${byteRange.offset ?? ""}:${byteRange.length}` : url;
  }
  async mapConcurrent(items, concurrency, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const runner = /* @__PURE__ */ __name(async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) {
          return;
        }
        results[index] = await worker(items[index], index);
      }
    }, "runner");
    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, items.length) },
        () => runner()
      )
    );
    return results;
  }
};
function detectContainer(bytes, playlist) {
  if (playlist.segments.some((segment) => Boolean(segment.map?.uri))) {
    return "fmp4";
  }
  if (looksLikeTransportStream(bytes)) {
    return "mpegts";
  }
  const signature = new TextDecoder("latin1").decode(bytes.slice(0, 12));
  if (/ftyp|styp|moof/.test(signature)) {
    return "fmp4";
  }
  if (playlist.segments.some((segment) => /\.aac(?:$|[?#])/i.test(segment.uri))) {
    return "aac";
  }
  return "unknown";
}
__name(detectContainer, "detectContainer");
function looksLikeTransportStream(bytes) {
  if (bytes.byteLength < 188 * 3) {
    return false;
  }
  return bytes[0] === 71 && bytes[188] === 71 && bytes[376] === 71;
}
__name(looksLikeTransportStream, "looksLikeTransportStream");
function inferMimeType(container, kind) {
  switch (container) {
    case "fmp4":
      return kind === "audio" ? "audio/mp4" : "video/mp4";
    case "mpegts":
      return "video/mp2t";
    case "aac":
      return "audio/aac";
    default:
      return "application/octet-stream";
  }
}
__name(inferMimeType, "inferMimeType");
function inferExtension(container, kind) {
  switch (container) {
    case "fmp4":
      return kind === "audio" ? "m4a" : "mp4";
    case "mpegts":
      return "ts";
    case "aac":
      return "aac";
    default:
      return "bin";
  }
}
__name(inferExtension, "inferExtension");
async function sleep(milliseconds, signal) {
  if (milliseconds <= 0) {
    return;
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    const abort = /* @__PURE__ */ __name(() => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted", "AbortError"));
    }, "abort");
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}
__name(sleep, "sleep");

// src/hls/remuxer.ts
var import_mux = __toESM(require_mux(), 1);
var HlsRemuxError = class extends Error {
  constructor(message, details = {}) {
    super(message);
    this.details = details;
    this.name = "HlsRemuxError";
  }
  static {
    __name(this, "HlsRemuxError");
  }
};
var HlsRemuxer = class {
  static {
    __name(this, "HlsRemuxer");
  }
  remux(download, baseName = "media") {
    const { video, audio } = download;
    if (audio) {
      return this.remuxSeparateTracks(video, audio, baseName);
    }
    return this.finalizeSingleTrack(video, baseName);
  }
  finalizeSingleTrack(track, baseName) {
    if (track.container === "fmp4") {
      if (track.hasMultipleInitSegments) {
        throw new HlsRemuxError(
          "The HLS stream changes its fMP4 initialization segment and cannot be flattened safely by the lightweight Worker remuxer"
        );
      }
      return {
        bytes: concatUint8Arrays([
          ...track.initSegments,
          ...track.mediaUnits
        ]),
        filename: `${sanitizeFilename(baseName)}.mp4`,
        contentType: "video/mp4",
        mediaType: track.kind === "audio" ? "audio" : "video",
        remuxed: false
      };
    }
    if (track.container === "mpegts") {
      return {
        bytes: this.transmuxTransportStreams([track.mediaUnits]),
        filename: `${sanitizeFilename(baseName)}.mp4`,
        contentType: "video/mp4",
        mediaType: "video",
        remuxed: true
      };
    }
    if (track.container === "aac" && track.kind === "audio") {
      return {
        bytes: concatUint8Arrays(track.mediaUnits),
        filename: `${sanitizeFilename(baseName)}.aac`,
        contentType: "audio/aac",
        mediaType: "document",
        remuxed: false
      };
    }
    return {
      bytes: concatUint8Arrays([
        ...track.initSegments,
        ...track.mediaUnits
      ]),
      filename: `${sanitizeFilename(baseName)}.${track.extension}`,
      contentType: track.mimeType,
      mediaType: "document",
      remuxed: false
    };
  }
  remuxSeparateTracks(video, audio, baseName) {
    if (video.container === "mpegts" && audio.container === "mpegts") {
      return {
        bytes: this.transmuxTransportStreams([
          video.mediaUnits,
          audio.mediaUnits
        ]),
        filename: `${sanitizeFilename(baseName)}.mp4`,
        contentType: "video/mp4",
        mediaType: "video",
        remuxed: true
      };
    }
    throw new HlsRemuxError(
      "The selected HLS variant uses separate audio/video tracks that are not both MPEG-TS. This Worker can transmux muxed TS and paired TS renditions, but does not rewrite independent fMP4 moov track tables.",
      {
        videoContainer: video.container,
        audioContainer: audio.container
      }
    );
  }
  transmuxTransportStreams(trackUnits) {
    const transmuxer = new import_mux.default.mp4.Transmuxer({
      remux: true,
      keepOriginalTimestamps: false
    });
    const initSegments = [];
    const mediaSegments = [];
    const types = /* @__PURE__ */ new Set();
    transmuxer.on("data", (segment) => {
      if (segment.type) {
        types.add(segment.type);
      }
      if (segment.initSegment?.byteLength) {
        initSegments.push(segment.initSegment);
      }
      if (segment.data?.byteLength) {
        mediaSegments.push(segment.data);
      }
    });
    const maximumUnits = Math.max(...trackUnits.map((units) => units.length));
    for (let index = 0; index < maximumUnits; index += 1) {
      for (const units of trackUnits) {
        const unit = units[index];
        if (unit) {
          transmuxer.push(unit);
        }
      }
    }
    transmuxer.flush();
    transmuxer.dispose?.();
    if (!mediaSegments.length) {
      throw new HlsRemuxError("mux.js produced no fMP4 media segments");
    }
    const firstInit = initSegments[0];
    if (!firstInit) {
      throw new HlsRemuxError("mux.js produced no fMP4 initialization segment");
    }
    return concatUint8Arrays([
      firstInit,
      ...mediaSegments
    ]);
  }
};
function concatUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
__name(concatUint8Arrays, "concatUint8Arrays");
function sanitizeFilename(value) {
  return String(value || "media").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, " ").trim().slice(0, 160) || "media";
}
__name(sanitizeFilename, "sanitizeFilename");

// src/hls/parser.ts
var VARIABLE_REFERENCE_RE = /\{\$([A-Za-z0-9_-]+)\}/g;
function parseHlsAttributeList(input) {
  const attributes = {};
  let current = "";
  let quoted = false;
  let escaped = false;
  const chunks = [];
  for (const character of String(input || "")) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quoted) {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      current += character;
      continue;
    }
    if (character === "," && !quoted) {
      chunks.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current) {
    chunks.push(current);
  }
  for (const chunk of chunks) {
    const separator = chunk.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = chunk.slice(0, separator).trim().toUpperCase();
    let value = chunk.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    attributes[name] = value;
  }
  return attributes;
}
__name(parseHlsAttributeList, "parseHlsAttributeList");
function substituteVariables(value, variables) {
  return String(value).replace(VARIABLE_REFERENCE_RE, (_match, name) => {
    return variables.get(name) ?? _match;
  });
}
__name(substituteVariables, "substituteVariables");
function parseResolution(value) {
  const match = String(value || "").match(/^(\d+)x(\d+)$/i);
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  return {
    width,
    height,
    label: `${width}x${height}`
  };
}
__name(parseResolution, "parseResolution");
function parseByteRange(value) {
  if (!value) {
    return null;
  }
  const match = value.match(/^(\d+)(?:@(\d+))?$/);
  if (!match) {
    return null;
  }
  return {
    length: Number(match[1]),
    offset: match[2] == null ? null : Number(match[2])
  };
}
__name(parseByteRange, "parseByteRange");
function parseIv(value) {
  if (!value) {
    return null;
  }
  const hex = value.replace(/^0x/i, "").padStart(32, "0");
  if (!/^[0-9a-f]{32}$/i.test(hex)) {
    return null;
  }
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
__name(parseIv, "parseIv");
function resolveUri(value, playlistUrl, variables) {
  if (!value) {
    return null;
  }
  return resolvePublicRelativeUrl(substituteVariables(value, variables), playlistUrl);
}
__name(resolveUri, "resolveUri");
function applyDefine(attributes, variables, inherited, playlistUrl) {
  const name = attributes.NAME;
  const value = attributes.VALUE;
  const importedName = attributes.IMPORT;
  const queryParam = attributes.QUERYPARAM;
  if (name && value != null) {
    variables.set(name, substituteVariables(value, variables));
    return;
  }
  if (importedName && inherited.has(importedName)) {
    variables.set(importedName, inherited.get(importedName) || "");
    return;
  }
  if (queryParam) {
    const url = new URL(playlistUrl);
    const queryValue = url.searchParams.get(queryParam);
    if (queryValue != null) {
      variables.set(queryParam, queryValue);
    }
  }
}
__name(applyDefine, "applyDefine");
function selectIdentityKey(keys) {
  return keys.get("identity") ?? [...keys.values()][0] ?? null;
}
__name(selectIdentityKey, "selectIdentityKey");
function createKey(attributes, playlistUrl, variables) {
  return {
    method: String(attributes.METHOD || "NONE").toUpperCase(),
    uri: resolveUri(attributes.URI, playlistUrl, variables),
    iv: parseIv(attributes.IV),
    keyFormat: attributes.KEYFORMAT || null,
    keyFormatVersions: attributes.KEYFORMATVERSIONS || null
  };
}
__name(createKey, "createKey");
function createMap(attributes, playlistUrl, variables) {
  const uri = resolveUri(attributes.URI, playlistUrl, variables);
  if (!uri) {
    return null;
  }
  return {
    uri,
    byteRange: parseByteRange(attributes.BYTERANGE)
  };
}
__name(createMap, "createMap");
function createPart(attributes, playlistUrl, variables) {
  const uri = resolveUri(attributes.URI, playlistUrl, variables);
  if (!uri) {
    return null;
  }
  return {
    uri,
    duration: Number.isFinite(Number(attributes.DURATION)) ? Number(attributes.DURATION) : null,
    independent: attributes.INDEPENDENT === "YES",
    gap: attributes.GAP === "YES",
    byteRange: parseByteRange(attributes.BYTERANGE)
  };
}
__name(createPart, "createPart");
function inferImplicitRange(byteRange, uri, previousSegment) {
  if (!byteRange || byteRange.offset != null) {
    return byteRange;
  }
  if (previousSegment?.uri === uri && previousSegment.byteRange?.offset != null) {
    return {
      length: byteRange.length,
      offset: previousSegment.byteRange.offset + previousSegment.byteRange.length
    };
  }
  return byteRange;
}
__name(inferImplicitRange, "inferImplicitRange");
function parseHlsPlaylist(text, playlistUrl, inheritedVariables = /* @__PURE__ */ new Map()) {
  const rawText = String(text);
  const lines = rawText.split(/\r?\n/).map((line) => line.trim());
  if (!lines.some((line) => line === "#EXTM3U")) {
    throw new Error("Invalid HLS playlist: missing #EXTM3U");
  }
  const variables = new Map(inheritedVariables);
  const variants = [];
  const renditions = [];
  const segments = [];
  const trailingParts = [];
  const activeKeys = /* @__PURE__ */ new Map();
  let version = null;
  let independentSegments = false;
  let endList = false;
  let mediaSequence = 0;
  let targetDuration = null;
  let playlistType = null;
  let currentMap = null;
  let pendingByteRange = null;
  let pendingDuration = null;
  let pendingTitle = "";
  let pendingGap = false;
  let pendingDiscontinuity = false;
  let pendingProgramDateTime = null;
  let pendingParts = [];
  let pendingVariant = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    if (!line.startsWith("#")) {
      const uri = resolveUri(line, playlistUrl, variables);
      if (!uri) {
        pendingVariant = null;
        continue;
      }
      if (pendingVariant) {
        const resolution = parseResolution(pendingVariant.RESOLUTION);
        variants.push({
          uri,
          bandwidth: Number(pendingVariant.BANDWIDTH || 0),
          averageBandwidth: Number(pendingVariant["AVERAGE-BANDWIDTH"] || 0),
          score: Number(pendingVariant.SCORE || 0),
          resolution,
          frameRate: Number(pendingVariant["FRAME-RATE"] || 0),
          codecs: pendingVariant.CODECS || "",
          videoRange: pendingVariant["VIDEO-RANGE"] || "",
          audioGroup: pendingVariant.AUDIO || null,
          videoGroup: pendingVariant.VIDEO || null,
          subtitlesGroup: pendingVariant.SUBTITLES || null,
          closedCaptionsGroup: pendingVariant["CLOSED-CAPTIONS"] || null
        });
        pendingVariant = null;
        continue;
      }
      const previous = segments.at(-1);
      const byteRange = inferImplicitRange(pendingByteRange, uri, previous);
      const segment = {
        uri,
        duration: pendingDuration,
        title: pendingTitle,
        byteRange,
        map: currentMap,
        key: selectIdentityKey(activeKeys),
        keys: [...activeKeys.values()],
        mediaSequenceNumber: mediaSequence + segments.length,
        gap: pendingGap,
        discontinuity: pendingDiscontinuity,
        programDateTime: pendingProgramDateTime,
        parts: pendingParts
      };
      segments.push(segment);
      pendingByteRange = null;
      pendingDuration = null;
      pendingTitle = "";
      pendingGap = false;
      pendingDiscontinuity = false;
      pendingProgramDateTime = null;
      pendingParts = [];
      continue;
    }
    const separator = line.indexOf(":");
    const tag = (separator === -1 ? line.slice(1) : line.slice(1, separator)).toUpperCase();
    const value = separator === -1 ? "" : line.slice(separator + 1);
    switch (tag) {
      case "EXT-X-VERSION":
        version = Number(value) || null;
        break;
      case "EXT-X-INDEPENDENT-SEGMENTS":
        independentSegments = true;
        break;
      case "EXT-X-ENDLIST":
        endList = true;
        break;
      case "EXT-X-MEDIA-SEQUENCE":
        mediaSequence = Number(value) || 0;
        break;
      case "EXT-X-TARGETDURATION":
        targetDuration = Number(value) || null;
        break;
      case "EXT-X-PLAYLIST-TYPE":
        playlistType = value || null;
        break;
      case "EXT-X-DEFINE":
        applyDefine(
          parseHlsAttributeList(value),
          variables,
          inheritedVariables,
          playlistUrl
        );
        break;
      case "EXT-X-STREAM-INF":
        pendingVariant = parseHlsAttributeList(value);
        break;
      case "EXT-X-I-FRAME-STREAM-INF": {
        const attributes = parseHlsAttributeList(value);
        const uri = resolveUri(attributes.URI, playlistUrl, variables);
        if (uri) {
          variants.push({
            uri,
            bandwidth: Number(attributes.BANDWIDTH || 0),
            averageBandwidth: Number(attributes["AVERAGE-BANDWIDTH"] || 0),
            score: Number(attributes.SCORE || 0),
            resolution: parseResolution(attributes.RESOLUTION),
            frameRate: Number(attributes["FRAME-RATE"] || 0),
            codecs: attributes.CODECS || "",
            videoRange: attributes["VIDEO-RANGE"] || "",
            audioGroup: attributes.AUDIO || null,
            videoGroup: attributes.VIDEO || null,
            subtitlesGroup: attributes.SUBTITLES || null,
            closedCaptionsGroup: attributes["CLOSED-CAPTIONS"] || null
          });
        }
        break;
      }
      case "EXT-X-MEDIA": {
        const attributes = parseHlsAttributeList(value);
        const groupId = attributes["GROUP-ID"] || "";
        const name = attributes.NAME || "";
        if (!groupId || !name) {
          break;
        }
        renditions.push({
          type: String(attributes.TYPE || "").toUpperCase(),
          groupId,
          name,
          uri: resolveUri(attributes.URI, playlistUrl, variables),
          language: attributes.LANGUAGE || null,
          default: attributes.DEFAULT === "YES",
          autoselect: attributes.AUTOSELECT === "YES",
          forced: attributes.FORCED === "YES",
          channels: attributes.CHANNELS || null
        });
        break;
      }
      case "EXTINF": {
        const comma = value.indexOf(",");
        const durationValue = comma === -1 ? value : value.slice(0, comma);
        pendingDuration = Number.isFinite(Number(durationValue)) ? Number(durationValue) : null;
        pendingTitle = comma === -1 ? "" : value.slice(comma + 1);
        break;
      }
      case "EXT-X-BYTERANGE":
        pendingByteRange = parseByteRange(value);
        break;
      case "EXT-X-DISCONTINUITY":
        pendingDiscontinuity = true;
        break;
      case "EXT-X-PROGRAM-DATE-TIME":
        pendingProgramDateTime = value || null;
        break;
      case "EXT-X-GAP":
        pendingGap = true;
        break;
      case "EXT-X-KEY": {
        const key = createKey(parseHlsAttributeList(value), playlistUrl, variables);
        const identity = key.keyFormat || "identity";
        if (key.method === "NONE") {
          if (identity === "identity") {
            activeKeys.clear();
          } else {
            activeKeys.delete(identity);
          }
        } else {
          activeKeys.set(identity, key);
        }
        break;
      }
      case "EXT-X-MAP":
        currentMap = createMap(parseHlsAttributeList(value), playlistUrl, variables);
        break;
      case "EXT-X-PART": {
        const part = createPart(parseHlsAttributeList(value), playlistUrl, variables);
        if (part) {
          pendingParts.push(part);
        }
        break;
      }
      default:
        break;
    }
  }
  const variablesObject = Object.fromEntries(variables.entries());
  if (variants.length > 0) {
    const master = {
      kind: "master",
      url: playlistUrl,
      rawText,
      version,
      independentSegments,
      endList,
      variables: variablesObject,
      variants,
      renditions
    };
    return master;
  }
  trailingParts.push(...pendingParts);
  const media = {
    kind: "media",
    url: playlistUrl,
    rawText,
    version,
    independentSegments,
    endList,
    variables: variablesObject,
    mediaSequence,
    targetDuration,
    playlistType,
    segments,
    trailingParts
  };
  return media;
}
__name(parseHlsPlaylist, "parseHlsPlaylist");
function compareHlsVariants(left, right) {
  const scoreDifference = right.score - left.score;
  if (scoreDifference !== 0) {
    return scoreDifference;
  }
  const rightPixels = (right.resolution?.width || 0) * (right.resolution?.height || 0);
  const leftPixels = (left.resolution?.width || 0) * (left.resolution?.height || 0);
  if (rightPixels !== leftPixels) {
    return rightPixels - leftPixels;
  }
  if (right.frameRate !== left.frameRate) {
    return right.frameRate - left.frameRate;
  }
  const rightBandwidth = right.averageBandwidth || right.bandwidth;
  const leftBandwidth = left.averageBandwidth || left.bandwidth;
  return rightBandwidth - leftBandwidth;
}
__name(compareHlsVariants, "compareHlsVariants");

// src/hls/resolver.ts
var HLS_CONTENT_TYPES = /* @__PURE__ */ new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl"
]);
var HlsResolver = class {
  static {
    __name(this, "HlsResolver");
  }
  maxDepth;
  maxPlaylistBytes;
  headers;
  preferredAudioLanguage;
  preferSelfContained;
  constructor(options = {}) {
    this.maxDepth = Math.max(1, options.maxDepth ?? 8);
    this.maxPlaylistBytes = Math.max(1024, options.maxPlaylistBytes ?? 2 * 1024 * 1024);
    this.headers = options.headers || {};
    this.preferredAudioLanguage = options.preferredAudioLanguage || null;
    this.preferSelfContained = options.preferSelfContained ?? true;
  }
  async probe(url, options = {}) {
    const normalized = normalizePublicHttpUrl(url instanceof URL ? url.href : String(url));
    if (!normalized) {
      throw new Error("Resolved media URL is not allowed");
    }
    try {
      const response = await fetchPublic(normalized, {
        method: "HEAD",
        headers: this.mergeHeaders(options.headers),
        signal: options.signal
      });
      const contentType = getBaseContentType(response.headers.get("content-type"));
      const contentLengthHeader = Number(response.headers.get("content-length"));
      const finalUrl = response.url || normalized.href;
      return {
        url: finalUrl,
        contentType,
        contentLength: Number.isFinite(contentLengthHeader) && contentLengthHeader >= 0 ? contentLengthHeader : null,
        isPlaylist: HLS_CONTENT_TYPES.has(contentType) || looksLikeHlsUrl(finalUrl)
      };
    } catch {
      return {
        url: normalized.href,
        contentType: "",
        contentLength: null,
        isPlaylist: looksLikeHlsUrl(normalized.href)
      };
    }
  }
  async resolve(url, options = {}) {
    const visited = /* @__PURE__ */ new Set();
    const chain = [];
    const root = await this.resolvePlaylist(
      url instanceof URL ? url.href : String(url),
      0,
      visited,
      chain,
      /* @__PURE__ */ new Map(),
      options
    );
    if (root.playlist.kind !== "media") {
      throw new Error("HLS resolver did not reach a media playlist");
    }
    const audio = root.selectedVariant ? await this.resolveAudioRendition(
      root.masterPlaylist,
      root.selectedVariant,
      root.variables,
      options
    ) : null;
    return {
      root: chain[0] || root.playlist,
      chain,
      selectedVariant: root.selectedVariant,
      mediaPlaylist: root.playlist,
      audio
    };
  }
  async resolvePlaylist(url, depth, visited, chain, inheritedVariables, options) {
    if (depth > this.maxDepth) {
      throw new Error("Too many nested HLS playlists");
    }
    const normalized = normalizePublicHttpUrl(url);
    if (!normalized) {
      throw new Error("HLS playlist URL is not allowed");
    }
    if (visited.has(normalized.href)) {
      throw new Error("Circular HLS playlist reference detected");
    }
    visited.add(normalized.href);
    const fetched = await this.fetchPlaylist(normalized.href, options);
    const parsed = parseHlsPlaylist(
      fetched.text,
      fetched.url,
      inheritedVariables
    );
    chain.push(parsed);
    const variables = new Map(Object.entries(parsed.variables));
    if (parsed.kind === "media") {
      return {
        playlist: parsed,
        selectedVariant: null,
        masterPlaylist: null,
        variables
      };
    }
    const variants = this.orderVariants(parsed.variants);
    let lastError = null;
    for (const variant of variants) {
      const candidateChain = [...chain];
      try {
        const nested = await this.resolvePlaylist(
          variant.uri,
          depth + 1,
          new Set(visited),
          candidateChain,
          variables,
          options
        );
        chain.splice(0, chain.length, ...candidateChain);
        return {
          ...nested,
          selectedVariant: variant,
          masterPlaylist: parsed,
          variables
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("No usable HLS variant was found");
  }
  async resolveAudioRendition(master, variant, inheritedVariables, options) {
    if (!master || !variant.audioGroup) {
      return null;
    }
    const candidates = master.renditions.filter((rendition) => {
      return rendition.type === "AUDIO" && rendition.groupId === variant.audioGroup && Boolean(rendition.uri);
    }).sort((left, right) => this.compareRenditions(left, right));
    const selected = candidates[0];
    if (!selected?.uri) {
      return null;
    }
    const chain = [];
    const resolved = await this.resolvePlaylist(
      selected.uri,
      0,
      /* @__PURE__ */ new Set(),
      chain,
      inheritedVariables,
      options
    );
    return {
      rendition: selected,
      playlist: resolved.playlist
    };
  }
  orderVariants(variants) {
    const sorted = [...variants].sort(compareHlsVariants);
    if (!this.preferSelfContained) {
      return sorted;
    }
    const selfContained = sorted.filter((variant) => !variant.audioGroup);
    return selfContained.length > 0 ? [...selfContained, ...sorted.filter((variant) => variant.audioGroup)] : sorted;
  }
  compareRenditions(left, right) {
    const preferredLanguage = this.preferredAudioLanguage?.toLowerCase();
    const leftLanguageMatch = preferredLanguage && left.language?.toLowerCase() === preferredLanguage ? 1 : 0;
    const rightLanguageMatch = preferredLanguage && right.language?.toLowerCase() === preferredLanguage ? 1 : 0;
    if (rightLanguageMatch !== leftLanguageMatch) {
      return rightLanguageMatch - leftLanguageMatch;
    }
    if (right.default !== left.default) {
      return Number(right.default) - Number(left.default);
    }
    if (right.autoselect !== left.autoselect) {
      return Number(right.autoselect) - Number(left.autoselect);
    }
    return left.name.localeCompare(right.name);
  }
  async fetchPlaylist(url, options) {
    const headers = new Headers(this.mergeHeaders(options.headers));
    headers.set(
      "Accept",
      "application/vnd.apple.mpegurl, application/x-mpegurl, audio/mpegurl, text/plain;q=0.9, */*;q=0.1"
    );
    const response = await fetchPublic(url, {
      method: "GET",
      headers,
      signal: options.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while loading HLS playlist`);
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > this.maxPlaylistBytes) {
      throw new Error("HLS playlist exceeds the relay size limit");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > this.maxPlaylistBytes) {
      throw new Error("HLS playlist exceeds the relay size limit");
    }
    const text = new TextDecoder().decode(bytes);
    if (!text.trimStart().startsWith("#EXTM3U")) {
      throw new Error("The media URL did not return a valid HLS playlist");
    }
    return {
      url: response.url || url,
      text
    };
  }
  mergeHeaders(extra) {
    const headers = new Headers(this.headers);
    if (extra) {
      new Headers(extra).forEach((value, name) => {
        headers.set(name, value);
      });
    }
    return headers;
  }
};
function looksLikeHlsUrl(value) {
  const url = value instanceof URL ? value.href : String(value);
  return /\.m3u8(?:$|[?#])/i.test(url);
}
__name(looksLikeHlsUrl, "looksLikeHlsUrl");

// src/media.ts
var TELEGRAM_REMOTE_URL_LIMIT = 2e7;
var DEFAULT_MAX_MEDIA_BYTES = 49e6;
var HARD_MAX_MEDIA_BYTES = 49e6;
var DEFAULT_HLS_MAX_MEDIA_BYTES = 16e6;
var HARD_HLS_MAX_MEDIA_BYTES = 24e6;
var VIDEO_EXTENSIONS = /* @__PURE__ */ new Set(["mp4", "m4v", "mov", "webm"]);
var PHOTO_EXTENSIONS = /* @__PURE__ */ new Set(["jpg", "jpeg", "png", "webp", "avif", "gif"]);
var AUDIO_EXTENSIONS = /* @__PURE__ */ new Set([
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "oga",
  "wav",
  "flac"
]);
async function prepareMedia(input, options = {}) {
  const maxMediaBytes = clampMaxMediaBytes(options.maxMediaBytes);
  const hlsMaxMediaBytes = clampHlsMaxMediaBytes(options.hlsMaxMediaBytes);
  const resolver = new HlsResolver({
    maxDepth: 8,
    maxPlaylistBytes: 2 * 1024 * 1024,
    headers: input.mediaHeaders,
    preferSelfContained: true
  });
  const probe = await resolver.probe(input.mediaUrl, {
    headers: input.mediaHeaders,
    signal: options.signal
  });
  if (!probe.isPlaylist && !looksLikeHlsUrl(input.mediaUrl)) {
    const direct = {
      type: "file",
      url: probe.url,
      contentType: probe.contentType || inferContentTypeFromUrl(probe.url),
      contentLength: probe.contentLength,
      selectedBitrate: null,
      selectedResolution: null,
      playlistDepth: 0
    };
    if (!options.forceUpload && (direct.contentLength == null || direct.contentLength <= TELEGRAM_REMOTE_URL_LIMIT)) {
      return direct;
    }
    if (direct.contentLength != null && direct.contentLength > maxMediaBytes) {
      throw new Error(
        `Direct media is ${direct.contentLength} bytes, above the configured upload limit of ${maxMediaBytes} bytes`
      );
    }
    const bytes = await downloadDirectFile(
      direct.url,
      input.mediaHeaders,
      maxMediaBytes,
      options.signal
    );
    return {
      type: "upload",
      bytes,
      filename: filenameFromUrl(direct.url),
      contentType: direct.contentType || "application/octet-stream",
      mediaType: input.mediaType || inferTelegramMediaType(direct.url, direct.contentType),
      selectedBitrate: null,
      selectedResolution: null,
      playlistDepth: 0,
      sourceUrl: direct.url,
      hls: false,
      segmentCount: 1,
      encrypted: false,
      remuxed: false
    };
  }
  const resolved = await resolver.resolve(probe.url || input.mediaUrl.href, {
    headers: input.mediaHeaders,
    signal: options.signal
  });
  const downloader = new HlsDownloader({
    headers: input.mediaHeaders,
    concurrency: options.concurrency,
    maxMediaBytes: hlsMaxMediaBytes
  });
  const downloaded = await downloader.download(resolved, {
    signal: options.signal
  });
  const remuxer = new HlsRemuxer();
  const baseName = baseNameFromUrl(input.sourceUrl || input.mediaUrl.href);
  const remuxed = remuxer.remux(downloaded, baseName);
  if (remuxed.bytes.byteLength > hlsMaxMediaBytes) {
    throw new Error(
      `Remuxed HLS output is ${remuxed.bytes.byteLength} bytes, above the configured in-memory HLS limit of ${hlsMaxMediaBytes} bytes`
    );
  }
  const variant = resolved.selectedVariant;
  return {
    type: "upload",
    bytes: remuxed.bytes,
    filename: remuxed.filename,
    contentType: remuxed.contentType,
    mediaType: input.mediaType || remuxed.mediaType,
    selectedBitrate: variant?.averageBandwidth || variant?.bandwidth || null,
    selectedResolution: variant?.resolution?.label || null,
    playlistDepth: Math.max(0, resolved.chain.length - 1),
    sourceUrl: resolved.mediaPlaylist.url,
    hls: true,
    segmentCount: downloaded.video.segmentCount + (downloaded.audio?.segmentCount || 0),
    encrypted: downloaded.video.encrypted || Boolean(downloaded.audio?.encrypted),
    remuxed: remuxed.remuxed
  };
}
__name(prepareMedia, "prepareMedia");
function resolveMaxMediaBytes(rawValue) {
  const value = Number(rawValue);
  return clampMaxMediaBytes(Number.isFinite(value) ? value : void 0);
}
__name(resolveMaxMediaBytes, "resolveMaxMediaBytes");
function resolveConcurrency(rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    return 2;
  }
  return Math.min(4, Math.max(1, Math.floor(value)));
}
__name(resolveConcurrency, "resolveConcurrency");
function resolveHlsMaxMediaBytes(rawValue) {
  const value = Number(rawValue);
  return clampHlsMaxMediaBytes(Number.isFinite(value) ? value : void 0);
}
__name(resolveHlsMaxMediaBytes, "resolveHlsMaxMediaBytes");
function inferTelegramMediaType(mediaUrl, contentType) {
  const type = getBaseContentType(contentType);
  if (type.startsWith("image/")) {
    return "photo";
  }
  if (type.startsWith("video/")) {
    return "video";
  }
  if (type.startsWith("audio/")) {
    return "audio";
  }
  const extension = getFileExtension(mediaUrl);
  if (PHOTO_EXTENSIONS.has(extension)) {
    return "photo";
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }
  return "document";
}
__name(inferTelegramMediaType, "inferTelegramMediaType");
function clampHlsMaxMediaBytes(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_HLS_MAX_MEDIA_BYTES;
  }
  return Math.min(
    HARD_HLS_MAX_MEDIA_BYTES,
    Math.max(1e6, Math.floor(value))
  );
}
__name(clampHlsMaxMediaBytes, "clampHlsMaxMediaBytes");
function clampMaxMediaBytes(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_MEDIA_BYTES;
  }
  return Math.min(
    HARD_MAX_MEDIA_BYTES,
    Math.max(1e6, Math.floor(value))
  );
}
__name(clampMaxMediaBytes, "clampMaxMediaBytes");
async function downloadDirectFile(url, headers, maximumBytes, signal) {
  const response = await fetchPublic(url, {
    method: "GET",
    headers,
    signal
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} while downloading direct media`);
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maximumBytes) {
    throw new Error(
      `Direct media exceeds the configured upload limit of ${maximumBytes} bytes`
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) {
    throw new Error(
      `Direct media exceeds the configured upload limit of ${maximumBytes} bytes`
    );
  }
  return bytes;
}
__name(downloadDirectFile, "downloadDirectFile");
function inferContentTypeFromUrl(value) {
  const extension = getFileExtension(value);
  if (PHOTO_EXTENSIONS.has(extension)) {
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    return `image/${extension}`;
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return extension === "webm" ? "video/webm" : "video/mp4";
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    if (extension === "mp3") {
      return "audio/mpeg";
    }
    if (extension === "m4a") {
      return "audio/mp4";
    }
    return `audio/${extension}`;
  }
  return "application/octet-stream";
}
__name(inferContentTypeFromUrl, "inferContentTypeFromUrl");
function filenameFromUrl(value) {
  try {
    const url = new URL(value);
    const name = decodeURIComponent(url.pathname.split("/").pop() || "media");
    return sanitizeFilename2(name || "media");
  } catch {
    return "media";
  }
}
__name(filenameFromUrl, "filenameFromUrl");
function baseNameFromUrl(value) {
  const filename = filenameFromUrl(value);
  return filename.replace(/\.[a-z0-9]{1,8}$/i, "") || "media";
}
__name(baseNameFromUrl, "baseNameFromUrl");
function sanitizeFilename2(value) {
  return String(value || "media").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, " ").trim().slice(0, 160) || "media";
}
__name(sanitizeFilename2, "sanitizeFilename");

// src/telegram.ts
async function sendTelegramUrl(options) {
  const { method, field } = getTelegramMethod(options.mediaType);
  const payload = {
    chat_id: options.chatId,
    [field]: options.mediaUrl
  };
  if (options.mediaType === "video") {
    payload.supports_streaming = true;
  }
  if (options.caption) {
    payload.caption = options.caption;
  }
  if (options.parseMode) {
    payload.parse_mode = options.parseMode;
  }
  return requestTelegram(options.botToken, method, {
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
__name(sendTelegramUrl, "sendTelegramUrl");
async function sendTelegramUpload(options) {
  const { method, field } = getTelegramMethod(options.mediaType);
  const form = new FormData();
  form.set("chat_id", options.chatId);
  form.set(field, options.file, options.filename);
  if (options.mediaType === "video") {
    form.set("supports_streaming", "true");
  }
  if (options.caption) {
    form.set("caption", options.caption);
  }
  if (options.parseMode) {
    form.set("parse_mode", options.parseMode);
  }
  return requestTelegram(options.botToken, method, {
    body: form
  });
}
__name(sendTelegramUpload, "sendTelegramUpload");
async function sendTelegramMediaGroupUrl(options) {
  if (options.items.length < 2 || options.items.length > 10) {
    return {
      ok: false,
      description: `sendMediaGroup requires 2-10 items; received ${options.items.length}.`,
      requestMethod: "sendMediaGroup"
    };
  }
  const media = options.items.map((item, index) => {
    const entry = {
      type: item.mediaType,
      media: item.mediaUrl
    };
    if (item.mediaType === "video") {
      entry.supports_streaming = true;
    }
    const caption = item.caption || (index === 0 ? options.caption : "");
    const parseMode = item.caption ? item.parseMode ?? options.parseMode : index === 0 ? options.parseMode : null;
    if (caption) {
      entry.caption = caption;
      if (parseMode) {
        entry.parse_mode = parseMode;
      }
    }
    return entry;
  });
  return requestTelegram(options.botToken, "sendMediaGroup", {
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: options.chatId,
      media
    })
  });
}
__name(sendTelegramMediaGroupUrl, "sendTelegramMediaGroupUrl");
async function sendTelegramMediaGroupUpload(options) {
  if (options.items.length < 2 || options.items.length > 10) {
    return {
      ok: false,
      description: `sendMediaGroup requires 2-10 items; received ${options.items.length}.`,
      requestMethod: "sendMediaGroup"
    };
  }
  const form = new FormData();
  const media = options.items.map((item, index) => {
    const field = `media${index}`;
    form.set(field, item.file, item.filename);
    const entry = {
      type: item.mediaType,
      media: `attach://${field}`
    };
    if (item.mediaType === "video") entry.supports_streaming = true;
    const caption = item.caption || (index === 0 ? options.caption : "");
    const parseMode = item.caption ? item.parseMode ?? options.parseMode : index === 0 ? options.parseMode : null;
    if (caption) {
      entry.caption = caption;
      if (parseMode) entry.parse_mode = parseMode;
    }
    return entry;
  });
  form.set("chat_id", options.chatId);
  form.set("media", JSON.stringify(media));
  return requestTelegram(options.botToken, "sendMediaGroup", { body: form });
}
__name(sendTelegramMediaGroupUpload, "sendTelegramMediaGroupUpload");
function validateEnvironment(env) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return "Missing TELEGRAM_BOT_TOKEN secret";
  }
  if (!env.RELAY_TOKEN) {
    return "Missing RELAY_TOKEN secret";
  }
  return null;
}
__name(validateEnvironment, "validateEnvironment");
function getTelegramMethod(mediaType) {
  switch (mediaType) {
    case "photo":
      return {
        method: "sendPhoto",
        field: "photo"
      };
    case "audio":
      return {
        method: "sendAudio",
        field: "audio"
      };
    case "document":
      return {
        method: "sendDocument",
        field: "document"
      };
    case "video":
    default:
      return {
        method: "sendVideo",
        field: "video"
      };
  }
}
__name(getTelegramMethod, "getTelegramMethod");
async function requestTelegram(botToken, method, init) {
  const endpoint = `https://api.telegram.org/bot${botToken}/${method}`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      ...init
    });
  } catch (error) {
    return {
      ok: false,
      description: getErrorMessage(error),
      requestMethod: method
    };
  }
  const rawResponse = await response.text();
  let result;
  try {
    result = rawResponse ? JSON.parse(rawResponse) : { ok: response.ok };
  } catch {
    return {
      ok: false,
      httpStatus: response.status,
      requestMethod: method,
      rawResponse,
      description: [
        `Telegram returned a non-JSON response for ${method}.`,
        `HTTP status: ${response.status} ${response.statusText}`.trim(),
        rawResponse ? `Response body: ${rawResponse.slice(0, 4e3)}` : "Response body was empty."
      ].join(" ")
    };
  }
  if (!response.ok || !result.ok) {
    return {
      ...result,
      ok: false,
      httpStatus: response.status,
      requestMethod: method,
      rawResponse,
      description: [
        result.description || `Telegram rejected ${method}.`,
        `HTTP ${response.status}${result.error_code ? ` / Telegram error ${result.error_code}` : ""}.`
      ].join(" ")
    };
  }
  return {
    ...result,
    httpStatus: response.status,
    requestMethod: method
  };
}
__name(requestTelegram, "requestTelegram");
function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
__name(getErrorMessage, "getErrorMessage");

// src/social.ts
var USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
var PROVIDER_TIMEOUT_MS = 15e3;
function detectSocialProvider(value) {
  let hostname;
  try {
    hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  if (hostname === "instagram.com" || hostname.endsWith(".instagram.com")) return "instagram";
  if (hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com" || hostname.endsWith(".twitter.com")) return "twitter";
  if (hostname === "tiktok.com" || hostname.endsWith(".tiktok.com")) return "tiktok";
  return null;
}
__name(detectSocialProvider, "detectSocialProvider");
async function resolveSocialMedia(sourceUrl, env) {
  const source = detectSocialProvider(sourceUrl);
  if (!source) throw new Error("Unsupported social URL. Supported: Instagram, Twitter/X, TikTok.");
  const attempts = [];
  const providers = source === "instagram" ? [{ id: "zoraahub", run: /* @__PURE__ */ __name(() => resolveZoraaHub(sourceUrl), "run") }] : source === "twitter" ? [
    { id: "twirrl", run: /* @__PURE__ */ __name(() => resolveTwirrl(sourceUrl, env.TWIRRL_VERSION_TOKEN), "run") },
    { id: "dtwitter", run: /* @__PURE__ */ __name(() => resolveDTwitter(sourceUrl), "run") }
  ] : [{ id: "dtiktok", run: /* @__PURE__ */ __name(() => resolveDTikTok(sourceUrl), "run") }];
  for (const provider of providers) {
    const startedAt = Date.now();
    try {
      const result = await provider.run();
      if (!result.media.length) throw new Error("Resolver returned no usable media");
      attempts.push({ provider: provider.id, ok: true, durationMs: Date.now() - startedAt });
      return { source, sourceUrl, resolver: provider.id, attempts, ...result };
    } catch (error) {
      attempts.push({ provider: provider.id, ok: false, durationMs: Date.now() - startedAt, error: errorMessage(error) });
    }
  }
  throw new SocialResolverError(`All ${source} resolvers failed`, attempts);
}
__name(resolveSocialMedia, "resolveSocialMedia");
var SocialResolverError = class extends Error {
  constructor(message, attempts) {
    super(message);
    this.attempts = attempts;
    this.name = "SocialResolverError";
  }
  static {
    __name(this, "SocialResolverError");
  }
};
async function resolveZoraaHub(sourceUrl) {
  const data = await fetchJson("https://api.zoraahub.com/fetch.php", {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: "https://downreels.com",
      Referer: "https://downreels.com/",
      "User-Agent": USER_AGENT
    },
    body: JSON.stringify({ url: sourceUrl })
  });
  if (!data || String(data.status || "").toLowerCase() !== "ok") {
    throw new Error(data?.message || data?.error || "ZoraaHub returned an unsuccessful response");
  }
  const media = array(data.videos).map((item, index) => {
    const rawUrl = firstString(item?.url, item?.download, item?.downloadUrl, item?.src);
    const url = normalizeProviderUrl(rawUrl);
    if (!url) return null;
    const nested = unwrapKnownProxyUrl(url);
    return mediaItem(index, nested || url, inferType(item?.isVideo ?? item?.is_video, item?.type, nested || url), item);
  }).filter(isMedia);
  return {
    title: firstString(data.title, data.meta?.title),
    caption: firstString(data.caption, data.description),
    media
  };
}
__name(resolveZoraaHub, "resolveZoraaHub");
async function resolveTwirrl(sourceUrl, token) {
  const body = { u: sourceUrl, o: "iOS" };
  if (token?.trim()) body.v = token.trim();
  const data = await fetchJson("https://api.twirrl.app/video", {
    method: "POST",
    headers: { Accept: "application/json, text/plain, */*", "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(body)
  });
  const seen = /* @__PURE__ */ new Set();
  const variants = [];
  for (const item of array(data?.d?.i)) {
    if (!item || typeof item !== "object") continue;
    for (const value of Object.values(item)) {
      const url = normalizeProviderUrl(value?.u);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const resolution = resolutionFromUrl(url);
      variants.push({
        index: variants.length,
        url,
        type: "video",
        quality: resolution.label || "best",
        width: resolution.width,
        height: resolution.height,
        thumbnail: null,
        mediaHeaders: mediaHeadersForUrl(url)
      });
    }
  }
  variants.sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
  if (!variants.length) throw new Error(data?.error || data?.message || "Twirrl returned no valid video variants");
  return { title: "Twitter video", caption: null, media: [variants[0]] };
}
__name(resolveTwirrl, "resolveTwirrl");
async function resolveDTwitter(sourceUrl) {
  const version = { dtwitter: { api: "https://dtwitter.heismauri.com/" }, id: "6166", name: "DTwitter", version: "4.2.1" };
  const selector = { selector: false };
  const body = new FormData();
  body.set("url", sourceUrl);
  body.set("version", JSON.stringify(version));
  body.set("selector", JSON.stringify(selector));
  const data = await fetchJson("https://dtwitter.heismauri.com/", {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": USER_AGENT
    },
    body
  });
  const status = String(data?.status || "").trim().toLowerCase();
  if (status && status !== "success") throw new Error(data?.error || data?.message || `DTwitter status ${status}`);
  const candidates = array(data?.media).map((item, index) => {
    const url = normalizeProviderUrl(firstString(item?.link, item?.url, item?.src, item?.download, item?.downloadUrl));
    return url ? mediaItem(index, url, inferType(void 0, item?.type, url), item) : null;
  }).filter(isMedia);
  if (!candidates.length) throw new Error(data?.error || data?.message || "DTwitter returned no media");
  const videos = candidates.filter((item) => item.type === "video");
  videos.sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
  return { title: "Twitter media", caption: null, media: videos.length ? [videos[0]] : candidates };
}
__name(resolveDTwitter, "resolveDTwitter");
async function resolveDTikTok(sourceUrl) {
  const canonicalSourceUrl = await canonicalizeTikTokUrl(sourceUrl);
  const body = new FormData();
  body.set("url", canonicalSourceUrl);
  body.set("version", "4.3.3");
  const data = await fetchJson("https://dtiktok.heismauri.com/", {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": USER_AGENT
    },
    body
  });
  const status = String(data?.status || "").trim().toLowerCase();
  if (status && !["success", "ok", "true"].includes(status)) throw new Error(data?.error || data?.message || `DTikTok status ${status}`);
  const media = array(data?.media).map((item, index) => {
    const url = normalizeProviderUrl(firstString(item?.link, item?.url, item?.src, item?.download, item?.downloadUrl));
    return url ? mediaItem(index, url, inferType(void 0, item?.type, url), item) : null;
  }).filter(isMedia);
  if (!media.length) throw new Error(data?.error || data?.message || "DTikTok returned no media");
  return { title: "TikTok", caption: null, media };
}
__name(resolveDTikTok, "resolveDTikTok");
function mediaItem(index, url, type, item) {
  const explicitWidth = numberOrNull(item?.width);
  const explicitHeight = numberOrNull(item?.height);
  const fromUrl = resolutionFromUrl(url);
  const width = explicitWidth || fromUrl.width;
  const height = explicitHeight || fromUrl.height;
  return {
    index,
    url,
    type,
    quality: firstString(item?.quality, item?.resolution, width && height ? `${width}x${height}` : null),
    width,
    height,
    thumbnail: firstString(item?.thumbnail, item?.thumb, item?.poster, item?.cover),
    mediaHeaders: mediaHeadersForUrl(url)
  };
}
__name(mediaItem, "mediaItem");
function inferType(isVideo, rawType, url) {
  if (typeof isVideo === "boolean") return isVideo ? "video" : "photo";
  const type = String(rawType || "").toLowerCase();
  if (["image", "photo", "picture"].includes(type)) return "photo";
  if (["audio", "music", "mp3"].includes(type)) return "audio";
  if (["video", "mp4", "movie"].includes(type)) return "video";
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  if (/\.(jpe?g|png|webp|avif|gif)$/.test(path)) return "photo";
  if (/\.(mp3|m4a|aac|ogg|wav|flac)$/.test(path)) return "audio";
  return "video";
}
__name(inferType, "inferType");
function unwrapKnownProxyUrl(value) {
  try {
    let current = value;
    for (let i = 0; i < 4; i += 1) {
      const parsed = new URL(current);
      const keys = parsed.hostname === "media.zoraahub.com" && parsed.pathname.toLowerCase().includes("/download.php") ? ["url"] : ["mediaUrl", "media_url", "target", "source", "src", "url"];
      const nested = keys.map((key) => parsed.searchParams.get(key)).find(Boolean);
      if (!nested) break;
      const decoded = decodeRepeatedly(nested);
      if (!/^https?:\/\//i.test(decoded) || decoded === current) break;
      current = decoded;
    }
    return current;
  } catch {
    return value;
  }
}
__name(unwrapKnownProxyUrl, "unwrapKnownProxyUrl");
function normalizeProviderUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim().replace(/\\\//g, "/").replace(/&amp;/gi, "&");
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}
__name(normalizeProviderUrl, "normalizeProviderUrl");
function mediaHeadersForUrl(url) {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return { "User-Agent": USER_AGENT };
  }
  if (hostname === "video.twimg.com" || hostname.endsWith(".twimg.com")) {
    return {
      "User-Agent": USER_AGENT,
      Referer: "https://x.com/"
    };
  }
  if (hostname.endsWith(".tiktok.com") || hostname.endsWith(".tiktokcdn.com") || hostname.endsWith(".tiktokcdn-us.com")) {
    return {
      "User-Agent": USER_AGENT,
      Referer: "https://www.tiktok.com/"
    };
  }
  if (hostname.endsWith(".cdninstagram.com") || hostname.endsWith(".fbcdn.net")) {
    return {
      "User-Agent": USER_AGENT,
      Referer: "https://www.instagram.com/"
    };
  }
  return { "User-Agent": USER_AGENT };
}
__name(mediaHeadersForUrl, "mediaHeadersForUrl");
async function canonicalizeTikTokUrl(sourceUrl) {
  const canonicalPattern = /^https:\/\/(?:www\.)?tiktok\.com\/@[^/]+\/(?:video|photo)\/\d{8,}/i;
  if (canonicalPattern.test(sourceUrl)) {
    return sourceUrl;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("TikTok canonicalization timeout"), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(sourceUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": USER_AGENT
      }
    });
    const finalUrl = response.url || sourceUrl;
    if (canonicalPattern.test(finalUrl)) {
      return finalUrl;
    }
    const html = (await response.text()).slice(0, 25e4);
    const canonicalMatch = html.match(
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
    );
    if (canonicalMatch?.[1] && canonicalPattern.test(canonicalMatch[1])) {
      return canonicalMatch[1].replace(/&amp;/gi, "&");
    }
  } catch {
  } finally {
    clearTimeout(timer);
  }
  return sourceUrl;
}
__name(canonicalizeTikTokUrl, "canonicalizeTikTokUrl");
function decodeRepeatedly(value) {
  let current = value;
  for (let i = 0; i < 4; i += 1) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch {
      break;
    }
  }
  return current;
}
__name(decodeRepeatedly, "decodeRepeatedly");
function resolutionFromUrl(url) {
  const match = url.match(/\/(\d{2,5})x(\d{2,5})(?:\/|$)/i);
  if (!match) return { width: null, height: null, label: null };
  const width = Number(match[1]);
  const height = Number(match[2]);
  return { width, height, label: `${width}x${height}` };
}
__name(resolutionFromUrl, "resolutionFromUrl");
async function fetchJson(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("resolver timeout"), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, redirect: "follow" });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Resolver returned non-JSON: ${text.slice(0, 300)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
__name(fetchJson, "fetchJson");
function array(value) {
  return Array.isArray(value) ? value : [];
}
__name(array, "array");
function firstString(...values) {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}
__name(firstString, "firstString");
function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
__name(numberOrNull, "numberOrNull");
function isMedia(value) {
  return Boolean(value?.url);
}
__name(isMedia, "isMedia");
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
__name(errorMessage, "errorMessage");
function toRelayMediaType(type) {
  return type === "photo" ? "photo" : type;
}
__name(toRelayMediaType, "toRelayMediaType");

// src/index.ts
var JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8"
};
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400"
};
var ALLOWED_PARSE_MODES = /* @__PURE__ */ new Set([
  "HTML",
  "MarkdownV2"
]);
var ALLOWED_MEDIA_TYPES = /* @__PURE__ */ new Set([
  "video",
  "audio",
  "document",
  "photo"
]);
var index_default = {
  async fetch(request, env) {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      console.error("[media-relay] Unhandled request error", {
        method: request.method,
        url: request.url,
        error: getErrorMessage2(error)
      });
      return json({ ok: false, error: getErrorMessage2(error), stage: "unhandled" }, 500);
    }
  }
};
async function routeRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return handleOptions();
  if (request.method === "GET" && url.pathname === "/health") return handleHealth();
  if (request.method === "POST" && url.pathname === "/media/check") return handleMediaCheck(request, env);
  if (request.method === "GET" && (url.pathname === "/media" || url.pathname.startsWith("/media/"))) return handleMediaQuery(request, env);
  if (request.method === "POST" && url.pathname === "/send") return handleSend(request, env);
  if (request.method === "POST" && url.pathname === "/resolve") return handleResolve(request, env, false);
  if (request.method === "POST" && url.pathname === "/resolve-and-send") return handleResolve(request, env, true);
  if (request.method === "POST" && url.pathname === "/batch") return handleBatch(request, env);
  return json({ ok: false, error: "Not found" }, 404);
}
__name(routeRequest, "routeRequest");
async function handleResolve(request, env, send) {
  if (!isAuthorized(request, env)) {
    return json({ ok: false, error: "Unauthorized", stage: "authorization" }, 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  const sourceUrl = typeof body.url === "string" ? body.url.trim() : typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
  const normalized = normalizePublicHttpUrl(sourceUrl);
  if (!normalized) return json({ ok: false, error: "url/sourceUrl must be a public HTTP(S) URL" }, 400);
  let resolution;
  try {
    resolution = await resolveSocialMedia(normalized.href, env);
  } catch (error) {
    return json({ ok: false, error: getErrorMessage2(error), stage: "social-resolver", attempts: error instanceof SocialResolverError ? error.attempts : void 0 }, 422);
  }
  if (!send) return json({ ok: true, ...resolution });
  const channels = normalizeResolveChannels(body);
  const caption = typeof body.caption === "string" ? body.caption : resolution.caption || resolution.title || "";
  const parseMode = ALLOWED_PARSE_MODES.has(body.parseMode) ? body.parseMode : null;
  const common = { sourceUrl: resolution.sourceUrl, pageUrl: resolution.sourceUrl, provider: resolution.source, caption, parseMode, channels, mediaId: typeof body.mediaId === "string" ? body.mediaId : void 0, mediaKey: typeof body.mediaKey === "string" ? body.mediaKey : void 0, force: body.force === true, metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : { resolver: resolution.resolver } };
  const albumCompatible = resolution.media.length >= 2 && resolution.media.every((item) => item.type === "photo" || item.type === "video");
  if (albumCompatible) {
    const relayBody = {
      ...common,
      mediaItems: resolution.media.map((item) => ({
        mediaUrl: item.url,
        mediaType: toRelayMediaType(item.type),
        mediaHeaders: item.mediaHeaders
      }))
    };
    const response = await handleSend(cloneAuthorizedJsonRequest(request, relayBody), env);
    return mergeResolveResponse(response, resolution);
  }
  const deliveries = [];
  for (const item of resolution.media) {
    const response = await handleSend(
      cloneAuthorizedJsonRequest(request, {
        ...common,
        mediaUrl: item.url,
        mediaType: toRelayMediaType(item.type),
        mediaHeaders: item.mediaHeaders,
        mediaKey: common.mediaKey ? `${common.mediaKey}:${item.index}` : void 0,
        mediaId: common.mediaId ? `${common.mediaId}:${item.index}` : void 0
      }),
      env
    );
    const result = await response.json();
    deliveries.push({ media: item, status: response.status, result });
    if (!response.ok) return json({ ok: false, stage: "resolved-delivery", resolution, deliveries }, response.status);
  }
  return json({ ok: true, message: `Resolved and sent ${deliveries.length} media item(s)`, resolution, deliveries });
}
__name(handleResolve, "handleResolve");
function normalizeResolveChannels(body) {
  const values = [];
  if (typeof body.channel === "string") values.push(body.channel);
  if (Array.isArray(body.channels)) {
    for (const value of body.channels) if (typeof value === "string") values.push(value);
  }
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
__name(normalizeResolveChannels, "normalizeResolveChannels");
function cloneAuthorizedJsonRequest(request, body) {
  const headers = new Headers({ "Content-Type": "application/json" });
  const authorization = request.headers.get("Authorization");
  if (authorization) headers.set("Authorization", authorization);
  return new Request(new URL("/send", request.url), { method: "POST", headers, body: JSON.stringify(body) });
}
__name(cloneAuthorizedJsonRequest, "cloneAuthorizedJsonRequest");
async function mergeResolveResponse(response, resolution) {
  const payload = await response.json();
  return json({ ...payload, resolution }, response.status);
}
__name(mergeResolveResponse, "mergeResolveResponse");
var MAX_MEDIA_CHECK_ITEMS = 100;
var MAX_MEDIA_CHECK_CHANNELS = 100;
async function handleMediaCheck(request, env) {
  const startedAt = Date.now();
  if (!isAuthorized(request, env)) {
    return json({ ok: false, error: "Unauthorized", stage: "authorization" }, 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return json({ ok: false, error: "items must be a non-empty array" }, 400);
  }
  if (body.items.length > MAX_MEDIA_CHECK_ITEMS) {
    return json({ ok: false, error: `items can contain at most ${MAX_MEDIA_CHECK_ITEMS} entries` }, 400);
  }
  const channelValidation = normalizeTelegramChannels(body.channel, body.channels);
  if (!channelValidation.ok) {
    return json({ ok: false, error: channelValidation.error }, 400);
  }
  const requestedChannels = [...new Set(channelValidation.value)];
  if (requestedChannels.length > MAX_MEDIA_CHECK_CHANNELS) {
    return json({ ok: false, error: `channels can contain at most ${MAX_MEDIA_CHECK_CHANNELS} entries` }, 400);
  }
  let db;
  try {
    db = requireRelayDb(env);
  } catch (error) {
    return json({ ok: false, error: getErrorMessage2(error), stage: "database" }, 500);
  }
  const valid = [];
  const invalid = /* @__PURE__ */ new Map();
  await Promise.all(body.items.map(async (input, index) => {
    try {
      const identityInput = normalizeMediaCheckIdentityInput(input);
      if (!identityInput) {
        invalid.set(index, "Provide a mediaKey, provider + mediaId, or an HTTP(S) URL");
        return;
      }
      const identity = await resolveMediaIdentity(identityInput);
      valid.push({ index, input, identity });
    } catch (error) {
      invalid.set(index, getErrorMessage2(error));
    }
  }));
  valid.sort((left, right) => left.index - right.index);
  const validByIndex = new Map(valid.map((item) => [item.index, item]));
  const uniqueIdentities = [...new Map(valid.map((item) => [item.identity.key, item.identity])).values()];
  const records = await checkStoredMediaDeliveries(db, uniqueIdentities, requestedChannels);
  const results = body.items.map((input, index) => {
    const validationError = invalid.get(index);
    if (validationError) {
      return {
        index,
        input,
        valid: false,
        exists: false,
        error: validationError,
        channels: [],
        ...requestedChannels.length ? { requestedChannels: buildRequestedChannelStatus(requestedChannels, []) } : {}
      };
    }
    const normalized = validByIndex.get(index);
    const record = records.get(normalized.identity.key);
    const deliveries = record?.deliveries ?? [];
    return {
      index,
      input,
      valid: true,
      mediaKey: normalized.identity.key,
      provider: normalized.identity.provider,
      mediaId: normalized.identity.providerMediaId,
      canonicalUrl: normalized.identity.canonicalUrl,
      exists: Boolean(record),
      media: record?.media ?? null,
      channels: deliveries,
      ...requestedChannels.length ? { requestedChannels: buildRequestedChannelStatus(requestedChannels, deliveries) } : {}
    };
  });
  const uniqueFound = uniqueIdentities.filter((identity) => records.has(identity.key)).length;
  const validCount = valid.length;
  const foundInputs = results.filter((item) => item.valid && item.exists).length;
  return json({
    ok: true,
    results,
    meta: {
      requested: body.items.length,
      valid: validCount,
      invalid: body.items.length - validCount,
      unique: uniqueIdentities.length,
      found: uniqueFound,
      missing: uniqueIdentities.length - uniqueFound,
      foundInputs,
      queryCount: uniqueIdentities.length ? 1 : 0,
      channelFilterCount: requestedChannels.length,
      durationMs: Date.now() - startedAt
    }
  });
}
__name(handleMediaCheck, "handleMediaCheck");
function normalizeMediaCheckIdentityInput(input) {
  if (typeof input === "string") {
    const value = input.trim();
    if (!value) return null;
    const url = normalizePublicHttpUrl(value);
    return url ? { sourceUrl: url.href } : value.includes(":") ? { mediaKey: value } : null;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const item = input;
  const mediaKey = typeof item.mediaKey === "string" ? item.mediaKey.trim() : "";
  const provider = typeof item.provider === "string" ? item.provider.trim() : "";
  const mediaId = typeof item.mediaId === "string" ? item.mediaId.trim() : "";
  const rawUrl = [item.url, item.sourceUrl, item.pageUrl, item.mediaUrl].find((value) => typeof value === "string" && value.trim());
  const normalizedUrl = rawUrl ? normalizePublicHttpUrl(rawUrl) : null;
  if (mediaKey) return { mediaKey, provider: provider || null, mediaId: mediaId || null, sourceUrl: normalizedUrl?.href ?? null };
  if (provider && mediaId) return { provider, mediaId, sourceUrl: normalizedUrl?.href ?? null };
  if (normalizedUrl) return { provider: provider || null, mediaId: mediaId || null, sourceUrl: normalizedUrl.href };
  return null;
}
__name(normalizeMediaCheckIdentityInput, "normalizeMediaCheckIdentityInput");
function buildRequestedChannelStatus(requestedChannels, deliveries) {
  const byChannel = new Map(deliveries.map((delivery) => [delivery.channelId, delivery]));
  return Object.fromEntries(requestedChannels.map((channelId) => {
    const delivery = byChannel.get(channelId);
    return [channelId, delivery ? { sent: true, sendCount: delivery.sendCount, firstSentAt: delivery.firstSentAt, lastSentAt: delivery.lastSentAt } : { sent: false, sendCount: 0, firstSentAt: null, lastSentAt: null }];
  }));
}
__name(buildRequestedChannelStatus, "buildRequestedChannelStatus");
async function handleMediaQuery(request, env) {
  if (!isAuthorized(request, env)) return json({ ok: false, error: "Unauthorized", stage: "authorization" }, 401);
  let db;
  try {
    db = requireRelayDb(env);
  } catch (error) {
    return json({ ok: false, error: getErrorMessage2(error), stage: "database" }, 500);
  }
  const url = new URL(request.url);
  const pathKey = url.pathname.startsWith("/media/") ? decodeURIComponent(url.pathname.slice("/media/".length)) : "";
  const key = pathKey || url.searchParams.get("key") || "";
  if (key) {
    const record = await getStoredMedia(db, key);
    return record ? json({ ok: true, ...record }) : json({ ok: false, error: "Media not found", key }, 404);
  }
  const limitValue = Number(url.searchParams.get("limit") || 25);
  const items = await findStoredMedia(db, {
    provider: url.searchParams.get("provider"),
    mediaId: url.searchParams.get("mediaId"),
    sourceUrl: url.searchParams.get("sourceUrl"),
    limit: Number.isFinite(limitValue) ? limitValue : 25
  });
  return json({ ok: true, count: items.length, items });
}
__name(handleMediaQuery, "handleMediaQuery");
var MAX_BATCH_ITEMS = 50;
var DEFAULT_BATCH_CONCURRENCY = 3;
var MAX_BATCH_CONCURRENCY = 5;
async function handleBatch(request, env) {
  const batchStartedAt = Date.now();
  if (!isAuthorized(request, env)) {
    return json({ ok: false, error: "Unauthorized", stage: "authorization" }, 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }
  const rawItems = Array.isArray(body.items) ? body.items : Array.isArray(body.links) ? body.links : null;
  if (!rawItems?.length) {
    return json({ ok: false, error: "Batch requires a non-empty links[] or items[] array." }, 400);
  }
  if (rawItems.length > MAX_BATCH_ITEMS) {
    return json({ ok: false, error: `A batch can contain at most ${MAX_BATCH_ITEMS} links/items.` }, 400);
  }
  const channelValidation = normalizeTelegramChannels(body.channel, body.channels);
  if (!channelValidation.ok) return json({ ok: false, error: channelValidation.error }, 400);
  const sharedChannels = resolveTelegramChatIds(channelValidation.value, env.TELEGRAM_CHAT_ID);
  if (!sharedChannels.length) return json({ ok: false, error: "No Telegram channel was provided." }, 400);
  let db;
  try {
    db = requireRelayDb(env);
  } catch (error) {
    return json({ ok: false, error: getErrorMessage2(error), stage: "database" }, 500);
  }
  const invalidResults = /* @__PURE__ */ new Map();
  const prepared = [];
  await Promise.all(rawItems.map(async (raw, index) => {
    const item = typeof raw === "string" ? { url: raw } : raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
    if (!item) {
      invalidResults.set(index, { index, ok: false, status: 400, error: "Batch item must be a URL string or object." });
      return;
    }
    const itemChannelsValidation = item.channel !== void 0 || item.channels !== void 0 ? normalizeTelegramChannels(item.channel, item.channels) : { ok: true, value: sharedChannels };
    if (!itemChannelsValidation.ok) {
      invalidResults.set(index, { index, ok: false, status: 400, error: itemChannelsValidation.error });
      return;
    }
    const channels = resolveTelegramChatIds(
      itemChannelsValidation.value.length ? itemChannelsValidation.value : sharedChannels,
      env.TELEGRAM_CHAT_ID
    );
    if (!channels.length) {
      invalidResults.set(index, { index, ok: false, status: 400, error: "No Telegram channel was provided for this batch item." });
      return;
    }
    const force = item.force === true || item.force === void 0 && body.force === true;
    const payload = {
      ...item,
      channels,
      force,
      caption: item.caption ?? body.caption,
      parseMode: item.parseMode ?? body.parseMode,
      metadata: item.metadata ?? body.metadata
    };
    delete payload.channel;
    const isDirect = "mediaUrl" in payload || "photoUrl" in payload || "videoUrl" in payload || "fileUrl" in payload || "mediaItems" in payload || "mediaUrls" in payload || "photoUrls" in payload;
    let identity = null;
    try {
      const identityInput = normalizeMediaCheckIdentityInput(payload);
      if (identityInput) identity = await resolveMediaIdentity(identityInput);
    } catch {
    }
    prepared.push({ index, input: item, payload, channels, force, identity, isDirect, preSkipped: [] });
  }));
  prepared.sort((left, right) => left.index - right.index);
  const preflightItems = prepared.filter((item) => !item.force && item.identity);
  const preflightIdentities = [...new Map(
    preflightItems.map((item) => [item.identity.key, item.identity])
  ).values()];
  const preflightChannels = [...new Set(preflightItems.flatMap((item) => item.channels))];
  const preflightStartedAt = Date.now();
  const existing = preflightIdentities.length ? await checkStoredMediaDeliveries(db, preflightIdentities, preflightChannels) : /* @__PURE__ */ new Map();
  const preflightDurationMs = Date.now() - preflightStartedAt;
  for (const item of preflightItems) {
    const storedKey = existing.get(item.identity.key)?.media.key;
    if (storedKey && storedKey !== item.identity.key) item.payload.mediaKey = storedKey;
  }
  const scheduledByMediaKey = /* @__PURE__ */ new Map();
  for (const item of prepared) {
    if (item.force || !item.identity) continue;
    const storedKey = existing.get(item.identity.key)?.media.key;
    const schedulingKeys = [storedKey || item.identity.key];
    const existingChannels = new Set((existing.get(item.identity.key)?.deliveries ?? []).map((delivery) => delivery.channelId));
    const preSkipped = [];
    for (const channelId of item.channels) {
      if (existingChannels.has(channelId)) {
        preSkipped.push({ channelId, reason: "already_sent" });
        continue;
      }
      let duplicateOfIndex;
      for (const key of schedulingKeys) {
        const scheduled = scheduledByMediaKey.get(key);
        const candidate = scheduled?.get(channelId);
        if (candidate !== void 0) {
          duplicateOfIndex = candidate;
          break;
        }
      }
      if (duplicateOfIndex !== void 0) {
        preSkipped.push({ channelId, reason: "duplicate_in_batch", duplicateOfIndex });
      }
    }
    item.preSkipped = preSkipped;
    const skippedChannelIds = new Set(item.preSkipped.map((entry) => entry.channelId));
    const channelsToSchedule = item.channels.filter((channelId) => !skippedChannelIds.has(channelId));
    for (const key of schedulingKeys) {
      const scheduled = scheduledByMediaKey.get(key) ?? /* @__PURE__ */ new Map();
      channelsToSchedule.forEach((channelId) => scheduled.set(channelId, item.index));
      scheduledByMediaKey.set(key, scheduled);
    }
    item.payload.channels = channelsToSchedule;
  }
  const concurrency = normalizeBatchConcurrency(body.concurrency);
  const processingStartedAt = Date.now();
  const processed = await mapWithConcurrency(prepared, concurrency, async (item) => {
    const channelsToSend = Array.isArray(item.payload.channels) ? item.payload.channels.filter((value) => typeof value === "string") : item.channels;
    if (!item.force && item.identity && channelsToSend.length === 0) {
      return {
        index: item.index,
        ok: false,
        partial: false,
        conflict: true,
        status: 409,
        error: "Media was already sent to every requested Telegram channel or duplicated inside this batch.",
        media: item.identity,
        channels: {
          requested: item.channels,
          attempted: [],
          inserted: [],
          notSent: item.preSkipped
        }
      };
    }
    const internal = cloneAuthorizedJsonRequest(request, item.payload);
    const response = item.isDirect ? await handleSend(internal, env) : await handleResolve(internal, env, true);
    const result = await response.json();
    const merged = mergeBatchPreflightResult(result, item.channels, item.preSkipped);
    return { index: item.index, status: response.status, ...merged };
  });
  const resultByIndex = /* @__PURE__ */ new Map();
  for (const result of processed) resultByIndex.set(Number(result.index), result);
  for (const [index, result] of invalidResults) resultByIndex.set(index, result);
  const results = rawItems.map((_, index) => resultByIndex.get(index) ?? {
    index,
    ok: false,
    status: 500,
    error: "Batch item did not produce a result."
  });
  const succeeded = results.filter((item) => item.ok === true).length;
  const conflicts = results.filter((item) => item.status === 409 || item.conflict === true).length;
  const failed = results.length - succeeded;
  const insertedChannels = results.reduce((total, item) => {
    const channels = item.channels;
    return total + (Array.isArray(channels?.inserted) ? channels.inserted.length : 0);
  }, 0);
  const skippedAlreadySent = results.reduce((total, item) => {
    const channels = item.channels;
    if (!Array.isArray(channels?.notSent)) return total;
    return total + channels.notSent.filter(
      (failure) => failure && typeof failure === "object" && failure.reason === "already_sent"
    ).length;
  }, 0);
  const skippedDuplicateInBatch = results.reduce((total, item) => {
    const channels = item.channels;
    if (!Array.isArray(channels?.notSent)) return total;
    return total + channels.notSent.filter(
      (failure) => failure && typeof failure === "object" && failure.reason === "duplicate_in_batch"
    ).length;
  }, 0);
  const metricNumber = /* @__PURE__ */ __name((item, key) => {
    const metrics = item.metrics && typeof item.metrics === "object" ? item.metrics : {};
    return Number(metrics[key] || 0) || 0;
  }, "metricNumber");
  const telegramAttempts = results.reduce((total, item) => total + metricNumber(item, "telegramAttempts"), 0);
  const identityAliasQueries = results.reduce((total, item) => total + metricNumber(item, "identityAliasQueries"), 0);
  const claimQueries = results.reduce((total, item) => total + metricNumber(item, "claimQueries"), 0);
  const dbRoundTrips = (preflightIdentities.length ? 1 : 0) + results.reduce((total, item) => total + metricNumber(item, "dbRoundTrips"), 0);
  const dbStatements = (preflightIdentities.length ? 1 : 0) + results.reduce((total, item) => total + metricNumber(item, "dbStatements"), 0);
  const mediaResolutions = prepared.filter((item) => !item.isDirect).length;
  const processingDurationMs = Date.now() - processingStartedAt;
  const status = succeeded === results.length ? 200 : succeeded > 0 ? 207 : conflicts === results.length ? 409 : 502;
  return json({
    ok: succeeded > 0,
    partial: succeeded > 0 && failed > 0,
    summary: {
      requested: results.length,
      succeeded,
      failed,
      conflicts,
      insertedChannels,
      skippedAlreadySent,
      skippedDuplicateInBatch,
      preflightQueries: preflightIdentities.length ? 1 : 0,
      identityAliasQueries,
      claimQueries,
      dbRoundTrips,
      dbStatements,
      mediaResolutions,
      telegramAttempts,
      concurrency,
      preflightDurationMs,
      processingDurationMs,
      durationMs: Date.now() - batchStartedAt
    },
    results
  }, status);
}
__name(handleBatch, "handleBatch");
function normalizeBatchConcurrency(value) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : DEFAULT_BATCH_CONCURRENCY;
  if (!Number.isFinite(numeric)) return DEFAULT_BATCH_CONCURRENCY;
  return Math.min(MAX_BATCH_CONCURRENCY, Math.max(1, Math.floor(numeric)));
}
__name(normalizeBatchConcurrency, "normalizeBatchConcurrency");
async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
__name(mapWithConcurrency, "mapWithConcurrency");
function mergeBatchPreflightResult(result, requestedChannels, preSkipped) {
  if (!preSkipped.length) return result;
  const channels = result.channels && typeof result.channels === "object" && !Array.isArray(result.channels) ? result.channels : {};
  const attempted = Array.isArray(channels.attempted) ? channels.attempted : [];
  const inserted = Array.isArray(channels.inserted) ? channels.inserted : [];
  const notSent = Array.isArray(channels.notSent) ? channels.notSent : [];
  const mergedNotSent = [
    ...preSkipped,
    ...notSent
  ];
  return {
    ...result,
    partial: inserted.length > 0 && mergedNotSent.length > 0,
    channels: {
      ...channels,
      requested: requestedChannels,
      attempted,
      inserted,
      notSent: mergedNotSent
    }
  };
}
__name(mergeBatchPreflightResult, "mergeBatchPreflightResult");
function handleHealth() {
  return json({
    ok: true,
    service: "generic-telegram-media-relay",
    version: "2.8.1",
    status: "online",
    runtime: "typescript-hls-remux-photo-album-d1-atomic-claims-batch-send",
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
}
__name(handleHealth, "handleHealth");
async function handleSend(request, env) {
  const configurationError = validateEnvironment(env);
  if (configurationError) {
    return json(
      {
        ok: false,
        error: configurationError
      },
      500
    );
  }
  if (!isAuthorized(request, env)) {
    return json(
      {
        ok: false,
        error: "Unauthorized",
        stage: "authorization",
        details: {
          expectedScheme: "Authorization: Bearer <RELAY_TOKEN>",
          authorizationHeaderPresent: Boolean(request.headers.get("Authorization"))
        }
      },
      401
    );
  }
  const contentType = request.headers.get("Content-Type") || "";
  if (/^multipart\/form-data\b/i.test(contentType)) {
    return handleMultipartSend(request, env);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json(
      {
        ok: false,
        error: "Invalid JSON body"
      },
      400
    );
  }
  const albumValidation = validateAlbumRequestBody(body);
  if (albumValidation.kind === "invalid") {
    return json(
      {
        ok: false,
        error: albumValidation.error
      },
      400
    );
  }
  if (albumValidation.kind === "valid") {
    return handleJsonAlbumSend(albumValidation.value, env);
  }
  const validation = validateRequestBody(body);
  if (!validation.ok) {
    return json(
      {
        ok: false,
        error: validation.error
      },
      400
    );
  }
  const input = validation.value;
  const chatIds = resolveTelegramChatIds(
    input.channels,
    env.TELEGRAM_CHAT_ID
  );
  if (!chatIds.length) {
    return json(
      {
        ok: false,
        error: "No Telegram channel was provided. Send channel/channels in the request or configure TELEGRAM_CHAT_ID as the default."
      },
      400
    );
  }
  let db;
  try {
    db = requireRelayDb(env);
  } catch (error) {
    return json({ ok: false, error: getErrorMessage2(error), stage: "database" }, 500);
  }
  const resolvedIdentity = await resolveMediaIdentity({
    provider: input.provider,
    mediaId: input.mediaId,
    mediaKey: input.mediaKey,
    sourceUrl: input.sourceUrl,
    pageUrl: input.pageUrl,
    mediaUrl: input.mediaUrl.href
  });
  const identityAliasQueries = resolvedIdentity.legacyKeys.length ? 1 : 0;
  const identity = await resolveStoredMediaIdentity(db, resolvedIdentity);
  const claim = input.force ? null : await acquireDeliveryClaims(db, identity, chatIds);
  const channelsToSend = input.force ? chatIds : claim.acquired;
  let claimChannelsToRelease = new Set(channelsToSend);
  const skippedAlreadySent = (claim?.alreadySent || []).map((channelId) => ({ channelId, reason: "already_sent" }));
  const skippedInProgress = (claim?.inProgress || []).map((channelId) => ({ channelId, reason: "delivery_in_progress" }));
  if (!channelsToSend.length) {
    return json({
      ok: false,
      conflict: true,
      error: skippedInProgress.length ? "Media delivery is already in progress for the requested Telegram channel(s)." : "Media was already sent to every requested Telegram channel.",
      media: identity,
      channels: { requested: chatIds, attempted: [], inserted: [], notSent: [...skippedAlreadySent, ...skippedInProgress] },
      hint: skippedInProgress.length ? "Wait for the in-flight delivery to complete before retrying." : "Pass force=true to resend and increment send_count.",
      metrics: { identityAliasQueries, claimQueries: claim?.queryCount || 0, claimedChannels: 0 }
    }, 409);
  }
  const maxMediaBytes = resolveMaxMediaBytes(env.MAX_MEDIA_BYTES);
  const concurrency = resolveConcurrency(env.HLS_CONCURRENCY);
  const hlsMaxMediaBytes = resolveHlsMaxMediaBytes(env.HLS_MAX_MEDIA_BYTES);
  let prepared;
  try {
    prepared = await prepareMedia(input, {
      maxMediaBytes,
      hlsMaxMediaBytes,
      concurrency,
      signal: request.signal
    });
  } catch (error) {
    console.error("[media-relay] Failed to prepare media", {
      inputUrl: input.mediaUrl.href,
      sourceUrl: input.sourceUrl,
      channels: chatIds,
      error: getErrorMessage2(error),
      metadata: input.metadata
    });
    if (claim) await releaseDeliveryClaims(db, identity, claim.requestId, channelsToSend).catch(() => {
    });
    return json(
      {
        ok: false,
        error: getErrorMessage2(error),
        stage: "prepare-media",
        source: {
          inputUrl: input.mediaUrl.href,
          sourceUrl: input.sourceUrl
        },
        channels: chatIds,
        metadata: input.metadata
      },
      422
    );
  }
  const mediaType = input.mediaType || (prepared.type === "file" ? inferTelegramMediaType(prepared.url, prepared.contentType) : prepared.mediaType);
  const delivery = prepared.type === "file" ? "telegram-url" : "multipart-upload";
  console.log("[media-relay] Sending media", {
    inputUrl: input.mediaUrl.href,
    sourceUrl: input.sourceUrl,
    channels: chatIds,
    delivery,
    mediaType,
    resolvedUrl: prepared.type === "file" ? prepared.url : prepared.sourceUrl,
    selectedBitrate: prepared.selectedBitrate,
    selectedResolution: prepared.selectedResolution,
    playlistDepth: prepared.playlistDepth,
    size: prepared.type === "file" ? prepared.contentLength : prepared.bytes.byteLength,
    hls: prepared.type === "file" ? false : prepared.hls,
    remuxed: prepared.type === "file" ? false : prepared.remuxed,
    metadata: input.metadata
  });
  try {
    const deliveries = await sendPreparedMediaToChats({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatIds: channelsToSend,
      prepared,
      mediaType,
      caption: input.caption,
      parseMode: input.parseMode
    });
    const failedDeliveries = deliveries.filter((deliveryResult) => !deliveryResult.result.ok);
    const successfulDeliveries = deliveries.filter((deliveryResult) => deliveryResult.result.ok);
    if (claim && successfulDeliveries.length) {
      for (const deliveryResult of successfulDeliveries) claimChannelsToRelease.delete(deliveryResult.requestedChatId);
    }
    const insertedChannelIds = await persistSuccessfulDeliveries(db, {
      identity,
      sourceUrl: input.sourceUrl,
      pageUrl: input.pageUrl,
      mediaType,
      mediaCount: 1,
      metadata: input.metadata,
      deliveries: successfulDeliveries.map((deliveryResult) => ({
        requestedChatId: deliveryResult.requestedChatId,
        telegramChatId: deliveryResult.result.result?.chat?.id ?? null,
        telegramChatTitle: deliveryResult.result.result?.chat?.title ?? null,
        messageIds: [deliveryResult.result.result?.message_id ?? null]
      }))
    });
    if (claim) claimChannelsToRelease = new Set(channelsToSend);
    const failedChannels = failedDeliveries.map((deliveryResult) => ({
      channelId: deliveryResult.requestedChatId,
      reason: "telegram_error",
      error: deliveryResult.result.description || "Telegram rejected the media request",
      httpStatus: deliveryResult.result.httpStatus ?? null
    }));
    const notSent = [...skippedAlreadySent, ...skippedInProgress, ...failedChannels];
    const firstMessage = successfulDeliveries[0]?.result.result;
    const payload = {
      ok: successfulDeliveries.length > 0,
      partial: notSent.length > 0,
      conflict: successfulDeliveries.length === 0 && skippedAlreadySent.length > 0,
      message: successfulDeliveries.length > 0 ? `Media sent to ${successfulDeliveries.length} Telegram channel(s)` : "Media was not sent to Telegram",
      media: identity,
      source: {
        inputUrl: input.mediaUrl.href,
        resolvedUrl: prepared.type === "file" ? prepared.url : prepared.sourceUrl,
        sourceUrl: input.sourceUrl
      },
      channels: {
        requested: chatIds,
        attempted: channelsToSend,
        inserted: insertedChannelIds,
        notSent
      },
      resolution: {
        selectedBitrate: prepared.selectedBitrate,
        selectedResolution: prepared.selectedResolution,
        playlistDepth: prepared.playlistDepth
      },
      processing: buildProcessingResult(prepared),
      telegram: {
        method: getTelegramMethodName(mediaType),
        messageId: firstMessage?.message_id ?? null,
        chatId: firstMessage?.chat?.id ?? null,
        chatTitle: firstMessage?.chat?.title ?? null,
        deliveries: deliveries.map(formatTelegramDelivery)
      },
      metadata: input.metadata,
      metrics: {
        identityAliasQueries,
        claimQueries: claim?.queryCount || 0,
        claimedChannels: channelsToSend.length,
        telegramAttempts: deliveries.length,
        successfulTelegramAttempts: successfulDeliveries.length,
        dbRoundTrips: identityAliasQueries + (claim ? 1 : 0) + (successfulDeliveries.length ? 1 : 0) + (claim ? 1 : 0),
        dbStatements: identityAliasQueries + (claim?.queryCount || 0) + (successfulDeliveries.length ? 1 + successfulDeliveries.length : 0) + (claim ? 1 : 0)
      }
    };
    if (!successfulDeliveries.length) {
      console.error("[media-relay] Telegram rejected every attempted delivery", { media: identity, notSent });
      return json(payload, 502);
    }
    return json(payload, notSent.length ? 207 : 200);
  } finally {
    if (claim && claimChannelsToRelease.size) {
      await releaseDeliveryClaims(db, identity, claim.requestId, [...claimChannelsToRelease]).catch(() => {
      });
    }
  }
}
__name(handleSend, "handleSend");
function albumItemToRelayInput(input, item) {
  return {
    mediaUrl: item.mediaUrl,
    sourceUrl: input.sourceUrl,
    pageUrl: input.pageUrl,
    provider: input.provider,
    title: input.title,
    text: input.text,
    caption: item.caption || input.caption,
    parseMode: item.parseMode ?? input.parseMode,
    mediaType: item.mediaType,
    mediaHeaders: item.mediaHeaders,
    channels: [],
    metadata: item.metadata ?? input.metadata,
    mediaId: input.mediaId,
    mediaKey: input.mediaKey,
    force: input.force
  };
}
__name(albumItemToRelayInput, "albumItemToRelayInput");
function albumUploadFilename(prepared, item, index) {
  const raw = String(prepared.filename || "").trim();
  if (/\.[a-z0-9]{2,8}$/i.test(raw)) return raw;
  const extension = item.mediaType === "photo" ? "jpg" : "mp4";
  return `${raw || `album-${index + 1}`}.${extension}`;
}
__name(albumUploadFilename, "albumUploadFilename");
function shouldRetryAlbumAsUpload(result) {
  if (result.ok) return false;
  const status = Number(result.httpStatus || 0);
  if (status !== 400 && status !== 413 && status !== 415) return false;
  return true;
}
__name(shouldRetryAlbumAsUpload, "shouldRetryAlbumAsUpload");
async function sendAlbumBatch(input, batch, env, chatId, batchIndex) {
  const direct = await sendTelegramMediaGroupUrl({
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId,
    items: batch.map((item) => ({
      mediaUrl: item.mediaUrl.href,
      mediaType: item.mediaType,
      caption: item.caption,
      parseMode: item.parseMode
    })),
    caption: batchIndex === 0 ? input.caption : "",
    parseMode: batchIndex === 0 ? input.parseMode : null
  });
  if (!shouldRetryAlbumAsUpload(direct)) {
    return { result: direct, transport: "url", fallbackAttempted: false, fallbackError: null };
  }
  try {
    const maxMediaBytes = resolveMaxMediaBytes(env.MAX_MEDIA_BYTES);
    const uploadBudget = resolveMultipartMaxTotalBytes(
      env.MULTIPART_MAX_TOTAL_BYTES,
      maxMediaBytes
    );
    const uploads = [];
    let totalBytes = 0;
    for (let index = 0; index < batch.length; index += 1) {
      const item = batch[index];
      const prepared = await prepareMedia(albumItemToRelayInput(input, item), {
        maxMediaBytes,
        concurrency: resolveConcurrency(env.HLS_CONCURRENCY),
        hlsMaxMediaBytes: resolveHlsMaxMediaBytes(env.HLS_MAX_MEDIA_BYTES),
        forceUpload: true
      });
      if (prepared.type !== "upload") {
        throw new Error(`Album item ${index + 1} did not produce an uploadable file.`);
      }
      totalBytes += prepared.bytes.byteLength;
      if (totalBytes > uploadBudget) {
        throw new Error(
          `Album upload fallback is ${totalBytes} bytes, above the safe ${uploadBudget} byte Worker forwarding budget.`
        );
      }
      uploads.push({
        mediaType: item.mediaType,
        file: new Blob([toBlobArrayBuffer(prepared.bytes)], { type: prepared.contentType }),
        filename: albumUploadFilename(prepared, item, index),
        caption: item.caption,
        parseMode: item.parseMode
      });
    }
    const uploaded = await sendTelegramMediaGroupUpload({
      botToken: env.TELEGRAM_BOT_TOKEN,
      chatId,
      items: uploads,
      caption: batchIndex === 0 ? input.caption : "",
      parseMode: batchIndex === 0 ? input.parseMode : null
    });
    return {
      result: uploaded.ok ? uploaded : {
        ...uploaded,
        description: [
          "Telegram rejected both album transports.",
          `URL: ${direct.description || "unknown error"}`,
          `multipart: ${uploaded.description || "unknown error"}`
        ].join(" ")
      },
      transport: "multipart-upload",
      fallbackAttempted: true,
      fallbackError: uploaded.ok ? null : uploaded.description || "Telegram rejected multipart upload"
    };
  } catch (error) {
    const fallbackError = getErrorMessage2(error);
    return {
      result: {
        ...direct,
        description: [
          direct.description || "Telegram rejected the URL album.",
          `Worker multipart fallback failed: ${fallbackError}`
        ].join(" ")
      },
      transport: "url",
      fallbackAttempted: true,
      fallbackError
    };
  }
}
__name(sendAlbumBatch, "sendAlbumBatch");
async function handleJsonAlbumSend(input, env) {
  const chatIds = resolveTelegramChatIds(input.channels, env.TELEGRAM_CHAT_ID);
  if (!chatIds.length) {
    return json(
      {
        ok: false,
        error: "No Telegram channel was provided. Send channel/channels in the request or configure TELEGRAM_CHAT_ID as the default."
      },
      400
    );
  }
  let db;
  try {
    db = requireRelayDb(env);
  } catch (error) {
    return json({ ok: false, error: getErrorMessage2(error), stage: "database" }, 500);
  }
  const resolvedIdentity = await resolveMediaIdentity({
    provider: input.provider,
    mediaId: input.mediaId,
    mediaKey: input.mediaKey,
    sourceUrl: input.sourceUrl,
    pageUrl: input.pageUrl,
    mediaUrl: input.items[0]?.mediaUrl.href || null
  });
  const identityAliasQueries = resolvedIdentity.legacyKeys.length ? 1 : 0;
  const identity = await resolveStoredMediaIdentity(db, resolvedIdentity);
  const claim = input.force ? null : await acquireDeliveryClaims(db, identity, chatIds);
  const channelsToSend = input.force ? chatIds : claim.acquired;
  let claimChannelsToRelease = new Set(channelsToSend);
  const skippedAlreadySent = (claim?.alreadySent || []).map((channelId) => ({ channelId, reason: "already_sent" }));
  const skippedInProgress = (claim?.inProgress || []).map((channelId) => ({ channelId, reason: "delivery_in_progress" }));
  if (!channelsToSend.length) {
    return json({
      ok: false,
      conflict: true,
      error: skippedInProgress.length ? "Album delivery is already in progress." : "Media was already sent to every requested Telegram channel.",
      media: identity,
      channels: { requested: chatIds, attempted: [], inserted: [], notSent: [...skippedAlreadySent, ...skippedInProgress] },
      hint: skippedInProgress.length ? "Wait for the in-flight delivery to complete before retrying." : "Pass force=true to resend the album.",
      metrics: { identityAliasQueries, claimQueries: claim?.queryCount || 0, claimedChannels: 0 }
    }, 409);
  }
  try {
    const batches = [];
    let batchCursor = 0;
    while (batchCursor < input.items.length) {
      const remaining = input.items.length - batchCursor;
      const batchSize = remaining > 10 && remaining % 10 === 1 ? 9 : Math.min(10, remaining);
      batches.push(input.items.slice(batchCursor, batchCursor + batchSize));
      batchCursor += batchSize;
    }
    const deliveries = [];
    for (const chatId of channelsToSend) {
      let itemOffset = 0;
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex];
        const attempt = await sendAlbumBatch(input, batch, env, chatId, batchIndex);
        deliveries.push({
          requestedChatId: chatId,
          batchIndex,
          itemOffset,
          itemCount: batch.length,
          result: attempt.result,
          transport: attempt.transport,
          fallbackAttempted: attempt.fallbackAttempted,
          fallbackError: attempt.fallbackError
        });
        itemOffset += batch.length;
      }
    }
    const formatted = deliveries.map((delivery) => ({
      requestedChatId: delivery.requestedChatId,
      batchIndex: delivery.batchIndex,
      itemOffset: delivery.itemOffset,
      itemCount: delivery.itemCount,
      ok: delivery.result.ok,
      transport: delivery.transport,
      fallbackAttempted: delivery.fallbackAttempted,
      fallbackError: delivery.fallbackError,
      httpStatus: delivery.result.httpStatus ?? null,
      error: delivery.result.ok ? null : delivery.result.description || "Telegram rejected sendMediaGroup",
      messageIds: Array.isArray(delivery.result.result) ? delivery.result.result.map((message) => message?.message_id ?? null) : []
    }));
    const completedChannels = channelsToSend.filter((chatId) => {
      const channelDeliveries = deliveries.filter((delivery) => delivery.requestedChatId === chatId);
      return channelDeliveries.length === batches.length && channelDeliveries.every((delivery) => delivery.result.ok);
    });
    const failedChannels = channelsToSend.filter((chatId) => !completedChannels.includes(chatId)).map((channelId) => {
      const errors = deliveries.filter((delivery) => delivery.requestedChatId === channelId && !delivery.result.ok);
      return {
        channelId,
        reason: "telegram_error",
        errors: errors.map((delivery) => ({ batchIndex: delivery.batchIndex, error: delivery.result.description || "Telegram rejected sendMediaGroup", httpStatus: delivery.result.httpStatus ?? null }))
      };
    });
    if (claim && completedChannels.length) {
      for (const channelId of completedChannels) claimChannelsToRelease.delete(channelId);
    }
    const insertedChannelIds = await persistSuccessfulDeliveries(db, {
      identity,
      sourceUrl: input.sourceUrl,
      pageUrl: input.pageUrl,
      mediaType: "album",
      mediaCount: input.items.length,
      metadata: input.metadata,
      deliveries: completedChannels.map((chatId) => {
        const channelDeliveries = deliveries.filter((delivery) => delivery.requestedChatId === chatId);
        const messages = channelDeliveries.flatMap((delivery) => Array.isArray(delivery.result.result) ? delivery.result.result : []);
        return {
          requestedChatId: chatId,
          telegramChatId: messages[0]?.chat?.id ?? null,
          telegramChatTitle: messages[0]?.chat?.title ?? null,
          messageIds: messages.map((message) => message.message_id ?? null)
        };
      })
    });
    if (claim) claimChannelsToRelease = new Set(channelsToSend);
    const notSent = [...skippedAlreadySent, ...skippedInProgress, ...failedChannels];
    const payload = {
      ok: completedChannels.length > 0,
      partial: notSent.length > 0,
      media: identity,
      message: completedChannels.length > 0 ? `Album delivered completely to ${completedChannels.length} Telegram channel(s)` : "Album was not completely delivered to any Telegram channel",
      mode: "telegram-media-group",
      source: { sourceUrl: input.sourceUrl, pageUrl: input.pageUrl },
      channels: { requested: chatIds, attempted: channelsToSend, inserted: insertedChannelIds, notSent },
      mediaSet: {
        count: input.items.length,
        batches: batches.length,
        items: input.items.map((item, index) => ({ index, mediaType: item.mediaType, mediaUrl: item.mediaUrl.href }))
      },
      telegram: { method: "sendMediaGroup", deliveries: formatted },
      metadata: input.metadata,
      metrics: {
        identityAliasQueries,
        claimQueries: claim?.queryCount || 0,
        claimedChannels: channelsToSend.length,
        telegramAttempts: deliveries.length,
        dbRoundTrips: identityAliasQueries + (claim ? 1 : 0) + (completedChannels.length ? 1 : 0) + (claim ? 1 : 0),
        dbStatements: identityAliasQueries + (claim?.queryCount || 0) + (completedChannels.length ? 1 + completedChannels.length : 0) + (claim ? 1 : 0)
      }
    };
    if (!completedChannels.length) return json(payload, 502);
    return json(payload, notSent.length ? 207 : 200);
  } finally {
    if (claim && claimChannelsToRelease.size) {
      await releaseDeliveryClaims(db, identity, claim.requestId, [...claimChannelsToRelease]).catch(() => {
      });
    }
  }
}
__name(handleJsonAlbumSend, "handleJsonAlbumSend");
async function sendPreparedMediaToChats(options) {
  const deliveries = [];
  for (const chatId of options.chatIds) {
    const result = options.prepared.type === "file" ? await sendTelegramUrl({
      botToken: options.botToken,
      chatId,
      mediaUrl: options.prepared.url,
      mediaType: options.mediaType,
      caption: options.caption,
      parseMode: options.parseMode
    }) : await sendTelegramUpload({
      botToken: options.botToken,
      chatId,
      file: new Blob([toBlobArrayBuffer(options.prepared.bytes)], {
        type: options.prepared.contentType
      }),
      filename: options.prepared.filename,
      contentType: options.prepared.contentType,
      mediaType: options.mediaType,
      caption: options.caption,
      parseMode: options.parseMode
    });
    deliveries.push({
      requestedChatId: chatId,
      result
    });
  }
  return deliveries;
}
__name(sendPreparedMediaToChats, "sendPreparedMediaToChats");
function toBlobArrayBuffer(bytes) {
  const { buffer, byteOffset, byteLength } = bytes;
  if (buffer instanceof ArrayBuffer) {
    if (byteOffset === 0 && byteLength === buffer.byteLength) return buffer;
    return buffer.slice(byteOffset, byteOffset + byteLength);
  }
  const copy = new Uint8Array(byteLength);
  copy.set(bytes);
  return copy.buffer;
}
__name(toBlobArrayBuffer, "toBlobArrayBuffer");
function formatTelegramDelivery(delivery) {
  const message = delivery.result.result;
  return {
    requestedChatId: delivery.requestedChatId,
    ok: delivery.result.ok,
    messageId: message?.message_id ?? null,
    chatId: message?.chat?.id ?? null,
    chatTitle: message?.chat?.title ?? null,
    error: delivery.result.ok ? null : delivery.result.description || "Telegram rejected the media request",
    httpStatus: delivery.result.httpStatus ?? null
  };
}
__name(formatTelegramDelivery, "formatTelegramDelivery");
function buildProcessingResult(prepared) {
  return prepared.type === "file" ? {
    delivery: "telegram-url",
    contentLength: prepared.contentLength,
    contentType: prepared.contentType
  } : {
    delivery: "multipart-upload",
    filename: prepared.filename,
    contentType: prepared.contentType,
    size: prepared.bytes.byteLength,
    hls: prepared.hls,
    segmentCount: prepared.segmentCount,
    encrypted: prepared.encrypted,
    remuxed: prepared.remuxed
  };
}
__name(buildProcessingResult, "buildProcessingResult");
function getTelegramMethodName(mediaType) {
  return mediaType === "photo" ? "sendPhoto" : mediaType === "audio" ? "sendAudio" : mediaType === "document" ? "sendDocument" : "sendVideo";
}
__name(getTelegramMethodName, "getTelegramMethodName");
function resolveTelegramChatIds(requestedChannels, defaultChatId) {
  if (requestedChannels.length) {
    return requestedChannels;
  }
  const fallback = String(defaultChatId || "").trim();
  return fallback ? [fallback] : [];
}
__name(resolveTelegramChatIds, "resolveTelegramChatIds");
function isAuthorized(request, env) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return false;
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    return false;
  }
  return safeTokenEqual(match[1].trim(), String(env.RELAY_TOKEN));
}
__name(isAuthorized, "isAuthorized");
function safeTokenEqual(left, right) {
  const a = String(left);
  const b = String(right);
  const maxLength = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < maxLength; index += 1) {
    const aCode = index < a.length ? a.charCodeAt(index) : 0;
    const bCode = index < b.length ? b.charCodeAt(index) : 0;
    difference |= aCode ^ bCode;
  }
  return difference === 0;
}
__name(safeTokenEqual, "safeTokenEqual");
function validateRequestBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      error: "Request body must be an object"
    };
  }
  const record = body;
  const rawMediaUrl = record.mediaUrl ?? record.photoUrl ?? record.videoUrl ?? record.fileUrl ?? record.url;
  const mediaUrl = normalizePublicHttpUrl(rawMediaUrl);
  if (!mediaUrl) {
    return {
      ok: false,
      error: "Invalid mediaUrl, photoUrl, or videoUrl"
    };
  }
  const pageUrl = normalizeOptionalSourceUrl(record.pageUrl);
  const sourceUrl = normalizeOptionalSourceUrl(
    record.sourceUrl ?? record.tweetUrl ?? record.pageUrl
  );
  const parseMode = normalizeParseMode(record.parseMode);
  if (record.parseMode && !parseMode) {
    return {
      ok: false,
      error: "Invalid parseMode. Allowed values: HTML, MarkdownV2"
    };
  }
  const mediaType = normalizeMediaType(record.mediaType);
  if (record.mediaType && !mediaType) {
    return {
      ok: false,
      error: "Invalid mediaType. Use photo, video, audio, or document"
    };
  }
  const channelValidation = normalizeTelegramChannels(
    record.channel,
    record.channels
  );
  if (!channelValidation.ok) {
    return {
      ok: false,
      error: channelValidation.error
    };
  }
  return {
    ok: true,
    value: {
      mediaUrl,
      sourceUrl,
      pageUrl,
      provider: normalizeOptionalText(record.provider, 120),
      title: normalizeOptionalText(record.title, 1e3),
      text: normalizeOptionalText(record.text, 2e4),
      caption: resolvePayloadCaption(record),
      parseMode: normalizeCaption(record.caption) ? parseMode : null,
      mediaType,
      mediaHeaders: normalizeMediaHeaders(record.mediaHeaders),
      channels: channelValidation.value,
      metadata: normalizeMetadata(record.metadata),
      mediaId: normalizeNullableText(record.mediaId, 240),
      mediaKey: normalizeNullableText(record.mediaKey, 300),
      force: record.force === true
    }
  };
}
__name(validateRequestBody, "validateRequestBody");
function validateAlbumRequestBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { kind: "none" };
  }
  const record = body;
  const rawItems = Array.isArray(record.mediaItems) ? record.mediaItems : Array.isArray(record.mediaUrls) ? record.mediaUrls : Array.isArray(record.photoUrls) ? record.photoUrls.map((mediaUrl) => ({ mediaUrl, mediaType: "photo" })) : null;
  if (!rawItems) {
    return { kind: "none" };
  }
  if (rawItems.length < 2) {
    return {
      kind: "invalid",
      error: "mediaItems/mediaUrls must contain at least 2 items for an album request."
    };
  }
  if (rawItems.length > 100) {
    return {
      kind: "invalid",
      error: "A maximum of 100 media items can be relayed in one album request."
    };
  }
  const parseMode = normalizeParseMode(record.parseMode);
  if (record.parseMode && !parseMode) {
    return {
      kind: "invalid",
      error: "Invalid parseMode. Allowed values: HTML, MarkdownV2"
    };
  }
  const items = [];
  for (let index = 0; index < rawItems.length; index += 1) {
    const rawItem = rawItems[index];
    let rawUrl = rawItem;
    let rawType = null;
    let rawCaption = null;
    let rawItemParseMode = null;
    let itemMetadata = null;
    let itemMediaHeaders = record.mediaHeaders;
    if (rawItem && typeof rawItem === "object" && !Array.isArray(rawItem)) {
      const item = rawItem;
      rawUrl = item.mediaUrl ?? item.photoUrl ?? item.videoUrl ?? item.url;
      rawType = item.mediaType ?? (item.photoUrl ? "photo" : item.videoUrl ? "video" : null);
      rawCaption = item.caption;
      rawItemParseMode = item.parseMode ?? item.parse_mode;
      itemMetadata = item.metadata;
      itemMediaHeaders = item.mediaHeaders ?? item.headers ?? record.mediaHeaders;
    }
    const mediaUrl = normalizePublicHttpUrl(rawUrl);
    if (!mediaUrl) {
      return {
        kind: "invalid",
        error: `Invalid public media URL at mediaItems[${index}].`
      };
    }
    if (/\.m3u8(?:$|[?#])/i.test(mediaUrl.href) || /\.mpd(?:$|[?#])/i.test(mediaUrl.href)) {
      return {
        kind: "invalid",
        error: `Album item ${index + 1} is HLS/DASH. Albums require direct photo/video URLs; use the single-media endpoint for prepared streaming media.`
      };
    }
    const mediaType = normalizeAlbumMediaType(rawType, mediaUrl.href);
    if (!mediaType) {
      return {
        kind: "invalid",
        error: `Invalid album mediaType at item ${index + 1}. Use photo or video.`
      };
    }
    const itemCaption = normalizeCaption(rawCaption);
    const itemParseMode = itemCaption ? normalizeParseMode(rawItemParseMode ?? record.parseMode) : null;
    if (rawItemParseMode && !itemParseMode) {
      return {
        kind: "invalid",
        error: `Invalid parseMode at mediaItems[${index}]. Allowed values: HTML, MarkdownV2`
      };
    }
    items.push({
      mediaUrl,
      mediaType,
      caption: itemCaption,
      parseMode: itemParseMode,
      mediaHeaders: normalizeMediaHeaders(itemMediaHeaders),
      metadata: normalizeMetadata(itemMetadata)
    });
  }
  const channelValidation = normalizeTelegramChannels(
    record.channel,
    record.channels
  );
  if (!channelValidation.ok) {
    return { kind: "invalid", error: channelValidation.error };
  }
  const pageUrl = normalizeOptionalSourceUrl(record.pageUrl);
  const explicitCaption = normalizeCaption(record.caption);
  return {
    kind: "valid",
    value: {
      items,
      sourceUrl: normalizeOptionalSourceUrl(
        record.sourceUrl ?? record.tweetUrl ?? record.pageUrl
      ),
      pageUrl,
      provider: normalizeOptionalText(record.provider, 120),
      title: normalizeOptionalText(record.title, 1e3),
      text: normalizeOptionalText(record.text, 2e4),
      caption: resolvePayloadCaption(record),
      parseMode: explicitCaption ? parseMode : null,
      channels: channelValidation.value,
      metadata: normalizeMetadata(record.metadata),
      mediaId: normalizeNullableText(record.mediaId, 240),
      mediaKey: normalizeNullableText(record.mediaKey, 300),
      force: record.force === true
    }
  };
}
__name(validateAlbumRequestBody, "validateAlbumRequestBody");
function normalizeAlbumMediaType(value, mediaUrl) {
  if (value) {
    const normalized = String(value).toLowerCase();
    return normalized === "photo" || normalized === "video" ? normalized : null;
  }
  return /\.(mp4|m4v|mov|webm)(?:$|[?#])/i.test(mediaUrl) ? "video" : "photo";
}
__name(normalizeAlbumMediaType, "normalizeAlbumMediaType");
function normalizeTelegramChannels(channelValue, channelsValue) {
  const hasChannel = channelValue !== void 0 && channelValue !== null;
  const hasChannels = channelsValue !== void 0 && channelsValue !== null;
  const values = [];
  if (hasChannel) {
    values.push(channelValue);
  }
  if (hasChannels) {
    if (Array.isArray(channelsValue)) {
      values.push(...channelsValue);
    } else {
      values.push(channelsValue);
    }
  }
  const channels = [];
  for (const value of values) {
    if (typeof value !== "string" && typeof value !== "number") {
      return {
        ok: false,
        error: "Invalid Telegram channel. channel/channels must contain chat IDs or @channel usernames."
      };
    }
    const normalized = String(value).trim();
    if (!normalized || normalized.length > 128 || /[\u0000-\u001F]/.test(normalized)) {
      return {
        ok: false,
        error: "Invalid Telegram channel value."
      };
    }
    if (!channels.includes(normalized)) {
      channels.push(normalized);
    }
  }
  if (channels.length > 20) {
    return {
      ok: false,
      error: "A maximum of 20 Telegram channels can be targeted per request."
    };
  }
  return {
    ok: true,
    value: channels
  };
}
__name(normalizeTelegramChannels, "normalizeTelegramChannels");
function normalizeNullableText(value, maximumLength) {
  const normalized = normalizeOptionalText(value, maximumLength);
  return normalized || null;
}
__name(normalizeNullableText, "normalizeNullableText");
function normalizeOptionalText(value, maximumLength) {
  if (value == null) return "";
  return String(value).trim().slice(0, maximumLength);
}
__name(normalizeOptionalText, "normalizeOptionalText");
function resolvePayloadCaption(record) {
  const explicit = normalizeCaption(record.caption);
  if (explicit) return explicit;
  const title = normalizeOptionalText(record.title, 1e3);
  const text = normalizeOptionalText(record.text, 2e4);
  const pageUrl = normalizeOptionalSourceUrl(
    record.pageUrl ?? record.sourceUrl ?? record.tweetUrl
  );
  return [title, text, pageUrl || ""].filter(Boolean).join("\n\n");
}
__name(resolvePayloadCaption, "resolvePayloadCaption");
function normalizeCaption(value) {
  if (value == null) {
    return "";
  }
  return typeof value === "string" ? value.trim() : String(value);
}
__name(normalizeCaption, "normalizeCaption");
function normalizeParseMode(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value);
  return ALLOWED_PARSE_MODES.has(normalized) ? normalized : null;
}
__name(normalizeParseMode, "normalizeParseMode");
function normalizeMediaType(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).toLowerCase();
  return ALLOWED_MEDIA_TYPES.has(normalized) ? normalized : null;
}
__name(normalizeMediaType, "normalizeMediaType");
function normalizeMediaHeaders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const allowed = /* @__PURE__ */ new Set([
    "accept",
    "accept-language",
    "authorization",
    "cookie",
    "origin",
    "referer",
    "user-agent"
  ]);
  const headers = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (!allowed.has(normalizedKey) || rawValue == null) {
      continue;
    }
    headers[key] = String(rawValue);
  }
  return headers;
}
__name(normalizeMediaHeaders, "normalizeMediaHeaders");
function normalizeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const metadata = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (rawValue == null) {
      continue;
    }
    if (typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean") {
      metadata[key.slice(0, 100)] = String(rawValue).slice(0, 2e3);
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : null;
}
__name(normalizeMetadata, "normalizeMetadata");
function getErrorMessage2(error) {
  return error instanceof Error ? error.message : String(error);
}
__name(getErrorMessage2, "getErrorMessage");
function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
}
__name(handleOptions, "handleOptions");
function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...CORS_HEADERS,
      "Cache-Control": "no-store"
    }
  });
}
__name(json, "json");
async function handleMultipartSend(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch (error) {
    return json(
      {
        ok: false,
        error: "Could not parse multipart/form-data request.",
        stage: "parse-multipart",
        details: {
          reason: getErrorMessage2(error),
          contentType: request.headers.get("Content-Type"),
          expectedFields: [
            "payload: JSON string",
            "file: one or more photo/video/audio/document files",
            "files: optional repeated file field",
            "audioFile: optional separate audio track"
          ]
        }
      },
      400
    );
  }
  const rawPayload = form.get("payload");
  let payload = {};
  if (typeof rawPayload === "string" && rawPayload.trim()) {
    try {
      const parsed = JSON.parse(rawPayload);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("payload must decode to a JSON object");
      }
      payload = parsed;
    } catch (error) {
      return json(
        {
          ok: false,
          error: "Invalid JSON in multipart payload field.",
          stage: "parse-payload",
          details: {
            reason: getErrorMessage2(error),
            payloadPreview: rawPayload.slice(0, 2e3)
          }
        },
        400
      );
    }
  }
  const channelValidation = normalizeTelegramChannels(
    payload.channel,
    payload.channels
  );
  if (!channelValidation.ok) {
    return json(
      {
        ok: false,
        error: channelValidation.error,
        stage: "validate-channels",
        details: {
          channel: payload.channel ?? null,
          channels: payload.channels ?? null
        }
      },
      400
    );
  }
  const chatIds = resolveTelegramChatIds(
    channelValidation.value,
    env.TELEGRAM_CHAT_ID
  );
  if (!chatIds.length) {
    return json(
      {
        ok: false,
        error: "No Telegram channel was provided.",
        stage: "validate-channels",
        details: {
          hint: "Send channel/channels inside payload or configure TELEGRAM_CHAT_ID."
        }
      },
      400
    );
  }
  const parseMode = normalizeParseMode(payload.parseMode);
  if (payload.parseMode && !parseMode) {
    return json(
      {
        ok: false,
        error: "Invalid parseMode. Allowed values: HTML, MarkdownV2",
        stage: "validate-payload",
        details: {
          received: payload.parseMode
        }
      },
      400
    );
  }
  const requestedMediaType = normalizeMediaType(payload.mediaType);
  if (payload.mediaType && !requestedMediaType) {
    return json(
      {
        ok: false,
        error: "Invalid mediaType. Use photo, video, audio, or document",
        stage: "validate-payload",
        details: {
          received: payload.mediaType
        }
      },
      400
    );
  }
  const uploadedFiles = [];
  form.forEach((value, field) => {
    if (!(value instanceof File) || value.size === 0) {
      return;
    }
    const mediaType = field === "audioFile" ? "audio" : requestedMediaType || inferUploadedFileMediaType(value);
    uploadedFiles.push({
      field,
      file: value,
      mediaType
    });
  });
  if (!uploadedFiles.length) {
    return json(
      {
        ok: false,
        error: "Multipart request did not contain any non-empty files.",
        stage: "validate-files",
        details: {
          receivedFields: collectFormFieldNames(form),
          acceptedFileFields: ["file", "files", "audioFile", "any repeated File field"],
          hint: "Append one or more File/Blob values to FormData. Example: form.append('file', blob, 'video.mp4')."
        }
      },
      400
    );
  }
  const maxMediaBytes = resolveMaxMediaBytes(env.MAX_MEDIA_BYTES);
  const oversized = uploadedFiles.filter(({ file }) => file.size > maxMediaBytes);
  if (oversized.length) {
    return json(
      {
        ok: false,
        error: "One or more uploaded files exceed the configured Worker upload limit.",
        stage: "validate-files",
        details: {
          maxMediaBytes,
          files: oversized.map(({ field, file }) => ({
            field,
            name: file.name,
            type: file.type,
            size: file.size
          }))
        }
      },
      413
    );
  }
  const multipartTotalBytes = uploadedFiles.reduce((sum, entry) => {
    return sum + entry.file.size;
  }, 0);
  const multipartMaxTotalBytes = resolveMultipartMaxTotalBytes(
    env.MULTIPART_MAX_TOTAL_BYTES,
    maxMediaBytes
  );
  if (multipartTotalBytes > multipartMaxTotalBytes) {
    return json(
      {
        ok: false,
        error: "The combined multipart file size exceeds the safe per-request forwarding budget.",
        stage: "validate-files",
        details: {
          multipartTotalBytes,
          multipartMaxTotalBytes,
          recommendation: "Send one file per POST and wait for the response before sending the next file.",
          files: uploadedFiles.map(({ field, file }) => ({
            field,
            name: file.name,
            type: file.type,
            size: file.size
          }))
        }
      },
      413
    );
  }
  let db;
  try {
    db = requireRelayDb(env);
  } catch (error) {
    return json({ ok: false, error: getErrorMessage2(error), stage: "database" }, 500);
  }
  const multipartIdentityFallback = payload.sourceUrl || payload.pageUrl || payload.mediaUrl || payload.photoUrl || payload.videoUrl || `multipart:${uploadedFiles.map(({ file }) => `${file.name}:${file.size}:${file.type}`).join("|")}`;
  const resolvedIdentity = await resolveMediaIdentity({
    provider: payload.provider || "multipart",
    mediaId: payload.mediaId || null,
    mediaKey: payload.mediaKey || null,
    sourceUrl: payload.sourceUrl || payload.pageUrl || null,
    pageUrl: payload.pageUrl || null,
    mediaUrl: multipartIdentityFallback
  });
  const identityAliasQueries = resolvedIdentity.legacyKeys.length ? 1 : 0;
  const identity = await resolveStoredMediaIdentity(db, resolvedIdentity);
  const claim = payload.force === true ? null : await acquireDeliveryClaims(db, identity, chatIds);
  const channelsToSend = payload.force === true ? chatIds : claim.acquired;
  let claimChannelsToRelease = new Set(channelsToSend);
  const skippedAlreadySent = (claim?.alreadySent || []).map((channelId) => ({ channelId, reason: "already_sent" }));
  const skippedInProgress = (claim?.inProgress || []).map((channelId) => ({ channelId, reason: "delivery_in_progress" }));
  if (!channelsToSend.length) {
    return json({
      ok: false,
      conflict: true,
      error: skippedInProgress.length ? "Media delivery is already in progress." : "Media was already sent to every requested Telegram channel.",
      media: identity,
      channels: { requested: chatIds, attempted: [], inserted: [], notSent: [...skippedAlreadySent, ...skippedInProgress] },
      hint: skippedInProgress.length ? "Wait for the in-flight delivery to complete before retrying." : "Pass force=true in the multipart payload to resend.",
      metrics: { identityAliasQueries, claimQueries: claim?.queryCount || 0, claimedChannels: 0 }
    }, 409);
  }
  try {
    const caption = resolvePayloadCaption(payload);
    const deliveries = [];
    for (let fileIndex = 0; fileIndex < uploadedFiles.length; fileIndex += 1) {
      const uploaded = uploadedFiles[fileIndex];
      for (const chatId of channelsToSend) {
        let result;
        try {
          result = await sendTelegramUpload({
            botToken: env.TELEGRAM_BOT_TOKEN,
            chatId,
            file: uploaded.file,
            filename: sanitizeUploadedFilename(uploaded.file.name, fileIndex),
            contentType: uploaded.file.type || inferUploadedContentType(uploaded.file.name),
            mediaType: uploaded.mediaType,
            caption: fileIndex === 0 ? caption : "",
            parseMode: fileIndex === 0 ? parseMode : null
          });
        } catch (error) {
          result = {
            ok: false,
            description: `Unexpected exception while forwarding uploaded file: ${getErrorMessage2(error)}`
          };
        }
        deliveries.push({
          fileIndex,
          field: uploaded.field,
          filename: uploaded.file.name,
          contentType: uploaded.file.type || inferUploadedContentType(uploaded.file.name),
          size: uploaded.file.size,
          mediaType: uploaded.mediaType,
          requestedChatId: chatId,
          result
        });
      }
    }
    const failed = deliveries.filter((entry) => !entry.result.ok);
    const succeeded = deliveries.filter((entry) => entry.result.ok);
    const completedChannels = channelsToSend.filter((chatId) => {
      const channelDeliveries = deliveries.filter((entry) => entry.requestedChatId === chatId);
      return channelDeliveries.length === uploadedFiles.length && channelDeliveries.every((entry) => entry.result.ok);
    });
    const failedChannels = channelsToSend.filter((chatId) => !completedChannels.includes(chatId)).map((channelId) => ({
      channelId,
      reason: "telegram_error",
      errors: deliveries.filter((entry) => entry.requestedChatId === channelId && !entry.result.ok).map((entry) => ({
        fileIndex: entry.fileIndex,
        error: entry.result.description || "Telegram rejected uploaded media",
        httpStatus: entry.result.httpStatus ?? null
      }))
    }));
    if (claim && completedChannels.length) {
      for (const channelId of completedChannels) claimChannelsToRelease.delete(channelId);
    }
    const insertedChannelIds = await persistSuccessfulDeliveries(db, {
      identity,
      sourceUrl: payload.sourceUrl || payload.pageUrl || null,
      pageUrl: payload.pageUrl || null,
      mediaType: uploadedFiles.length > 1 ? "album" : uploadedFiles[0].mediaType,
      mediaCount: uploadedFiles.length,
      metadata: normalizeMetadata(payload.metadata),
      deliveries: completedChannels.map((chatId) => {
        const messages = deliveries.filter((entry) => entry.requestedChatId === chatId && entry.result.ok).map((entry) => entry.result.result).filter((message) => Boolean(message));
        return {
          requestedChatId: chatId,
          telegramChatId: messages[0]?.chat?.id ?? null,
          telegramChatTitle: messages[0]?.chat?.title ?? null,
          messageIds: messages.map((message) => message.message_id ?? null)
        };
      })
    });
    if (claim) claimChannelsToRelease = new Set(channelsToSend);
    const notSent = [...skippedAlreadySent, ...skippedInProgress, ...failedChannels];
    const multipartMetrics = {
      identityAliasQueries,
      claimQueries: claim?.queryCount || 0,
      claimedChannels: channelsToSend.length,
      telegramAttempts: deliveries.length,
      successfulTelegramAttempts: succeeded.length,
      mediaResolutions: 0,
      dbRoundTrips: identityAliasQueries + (claim ? 1 : 0) + (completedChannels.length ? 1 : 0) + (claim ? 1 : 0),
      dbStatements: identityAliasQueries + (claim?.queryCount || 0) + (completedChannels.length ? 1 + completedChannels.length : 0) + (claim ? 1 : 0)
    };
    const formattedDeliveries = deliveries.map((entry) => ({
      fileIndex: entry.fileIndex,
      field: entry.field,
      filename: entry.filename,
      contentType: entry.contentType,
      size: entry.size,
      mediaType: entry.mediaType,
      requestedChatId: entry.requestedChatId,
      ok: entry.result.ok,
      telegramMethod: entry.result.requestMethod || getTelegramMethodName(entry.mediaType),
      httpStatus: entry.result.httpStatus ?? null,
      telegramErrorCode: entry.result.error_code ?? null,
      description: entry.result.description ?? null,
      parameters: entry.result.parameters ?? null,
      rawResponse: entry.result.rawResponse ?? null,
      messageId: entry.result.result?.message_id ?? null,
      chatId: entry.result.result?.chat?.id ?? null,
      chatTitle: entry.result.result?.chat?.title ?? null
    }));
    if (failed.length) {
      console.error("[media-relay] Multipart forwarding partially or fully failed", {
        files: uploadedFiles.map(({ field, file, mediaType }) => ({
          field,
          name: file.name,
          size: file.size,
          type: file.type,
          mediaType
        })),
        channels: chatIds,
        deliveries: formattedDeliveries,
        payload
      });
      return json(
        {
          ok: false,
          error: succeeded.length > 0 ? `${failed.length} of ${deliveries.length} Telegram deliveries failed.` : "All Telegram deliveries failed.",
          stage: "telegram-forward",
          summary: {
            filesReceived: uploadedFiles.length,
            channelsRequested: chatIds.length,
            deliveriesAttempted: deliveries.length,
            deliveriesSucceeded: succeeded.length,
            deliveriesFailed: failed.length
          },
          files: uploadedFiles.map(({ field, file, mediaType }, index) => ({
            index,
            field,
            filename: file.name,
            contentType: file.type || inferUploadedContentType(file.name),
            size: file.size,
            mediaType
          })),
          media: identity,
          channels: { requested: chatIds, attempted: channelsToSend, inserted: insertedChannelIds, notSent },
          telegram: {
            deliveries: formattedDeliveries
          },
          payload,
          metrics: multipartMetrics
        },
        succeeded.length > 0 ? 207 : 502
      );
    }
    return json({
      ok: true,
      message: uploadedFiles.length === 1 ? "Uploaded file forwarded to Telegram" : `${uploadedFiles.length} uploaded files forwarded to Telegram`,
      mode: "multipart-file-forward",
      summary: {
        filesReceived: uploadedFiles.length,
        channelsRequested: chatIds.length,
        deliveriesAttempted: deliveries.length,
        deliveriesSucceeded: succeeded.length,
        deliveriesFailed: 0
      },
      files: uploadedFiles.map(({ field, file, mediaType }, index) => ({
        index,
        field,
        filename: file.name,
        contentType: file.type || inferUploadedContentType(file.name),
        size: file.size,
        mediaType
      })),
      media: identity,
      channels: { requested: chatIds, attempted: channelsToSend, inserted: insertedChannelIds, notSent },
      telegram: {
        deliveries: formattedDeliveries
      },
      payload,
      metrics: multipartMetrics
    });
  } finally {
    if (claim && claimChannelsToRelease.size) {
      await releaseDeliveryClaims(db, identity, claim.requestId, [...claimChannelsToRelease]).catch(() => {
      });
    }
  }
}
__name(handleMultipartSend, "handleMultipartSend");
function inferUploadedFileMediaType(file) {
  const contentType = String(file.type || "").toLowerCase();
  const filename = String(file.name || "").toLowerCase();
  if (contentType.startsWith("image/") || /\.(jpe?g|png|webp|avif|gif)$/i.test(filename)) {
    return "photo";
  }
  if (contentType.startsWith("video/") || /\.(mp4|m4v|mov|webm)$/i.test(filename)) {
    return "video";
  }
  if (contentType.startsWith("audio/") || /\.(mp3|m4a|aac|ogg|oga|wav|flac)$/i.test(filename)) {
    return "audio";
  }
  return "document";
}
__name(inferUploadedFileMediaType, "inferUploadedFileMediaType");
function inferUploadedContentType(filename) {
  const value = String(filename || "").toLowerCase();
  if (/\.jpe?g$/i.test(value)) return "image/jpeg";
  if (/\.png$/i.test(value)) return "image/png";
  if (/\.webp$/i.test(value)) return "image/webp";
  if (/\.avif$/i.test(value)) return "image/avif";
  if (/\.gif$/i.test(value)) return "image/gif";
  if (/\.mp4$/i.test(value)) return "video/mp4";
  if (/\.webm$/i.test(value)) return "video/webm";
  if (/\.(m4v|mov)$/i.test(value)) return "video/mp4";
  if (/\.mp3$/i.test(value)) return "audio/mpeg";
  if (/\.m4a$/i.test(value)) return "audio/mp4";
  if (/\.aac$/i.test(value)) return "audio/aac";
  return "application/octet-stream";
}
__name(inferUploadedContentType, "inferUploadedContentType");
function sanitizeUploadedFilename(value, index) {
  const normalized = String(value || `media-${index + 1}`).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/\s+/g, " ").trim().slice(0, 160);
  return normalized || `media-${index + 1}.mp4`;
}
__name(sanitizeUploadedFilename, "sanitizeUploadedFilename");
function resolveMultipartMaxTotalBytes(rawValue, perFileMaximum) {
  const configured = Number(rawValue);
  const fallback = Math.min(64e6, perFileMaximum * 2);
  if (!Number.isFinite(configured)) {
    return fallback;
  }
  return Math.min(8e7, Math.max(perFileMaximum, Math.floor(configured)));
}
__name(resolveMultipartMaxTotalBytes, "resolveMultipartMaxTotalBytes");
function collectFormFieldNames(form) {
  const fields = [];
  form.forEach((_value, key) => {
    if (!fields.includes(key)) {
      fields.push(key);
    }
  });
  return fields;
}
__name(collectFormFieldNames, "collectFormFieldNames");
export {
  index_default as default
};
/*! Bundled license information:

mux.js/dist/mux.js:
  (*! @name mux.js @version 7.1.0 @license Apache-2.0 *)
*/
//# sourceMappingURL=index.js.map
