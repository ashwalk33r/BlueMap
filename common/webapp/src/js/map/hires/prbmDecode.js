/*
 * This file is part of BlueMap, licensed under the MIT License (MIT).
 * Pure PRWM/PRBM decoder (no three.js dependency) so it can run in a Web Worker.
 * Extracted from PRBMLoader.js (adapted PRWM by Kevin Chapelier,
 * https://github.com/kchapelier/PRWM). Returns raw typed arrays; the caller builds
 * the BufferGeometry. See PRBMLoader.js for the three.js-side wrapping.
 */

"use strict";

let bigEndianPlatform = null;

export function isBigEndianPlatform() {
    if (bigEndianPlatform === null) {
        let buffer = new ArrayBuffer(2),
            uint8Array = new Uint8Array(buffer),
            uint16Array = new Uint16Array(buffer);
        uint8Array[0] = 0xAA;
        uint8Array[1] = 0xBB;
        bigEndianPlatform = (uint16Array[0] === 0xAABB);
    }
    return bigEndianPlatform;
}

const InvertedEncodingTypes = [
    null, Float32Array, null, Int8Array, Int16Array, null, Int32Array,
    Uint8Array, Uint16Array, null, Uint32Array
];

const getMethods = {
    Uint16Array: 'getUint16', Uint32Array: 'getUint32', Int16Array: 'getInt16',
    Int32Array: 'getInt32', Float32Array: 'getFloat32', Float64Array: 'getFloat64'
};

function copyFromBuffer(sourceArrayBuffer, viewType, position, length, fromBigEndian) {
    let bytesPerElement = viewType.BYTES_PER_ELEMENT, result;
    if (fromBigEndian === isBigEndianPlatform() || bytesPerElement === 1) {
        result = new viewType(sourceArrayBuffer, position, length);
    } else {
        console.debug("PRWM file has opposite encoding, loading will be slow...");
        let readView = new DataView(sourceArrayBuffer, position, length * bytesPerElement),
            getMethod = getMethods[viewType.name],
            littleEndian = !fromBigEndian, i = 0;
        result = new viewType(length);
        for (; i < length; i++) result[i] = readView[getMethod](i * bytesPerElement, littleEndian);
    }
    return result;
}

function read4ByteInt(array, pos) {
    return array[pos] | array[pos + 1] << 8 | array[pos + 2] << 16 | array[pos + 3] << 24;
}

/**
 * Decode a PRWM/PRBM buffer into raw attribute arrays.
 * @param buffer {ArrayBuffer}
 * @param offset {number}
 * @returns {{version:number, attributes:Object, indices:(Uint16Array|Uint32Array|null), groups:Array}}
 */
export function decodePrwm(buffer, offset) {
    offset = offset || 0;

    let array = new Uint8Array(buffer, offset),
        version = array[0],
        flags = array[1],
        indexedGeometry = !!(flags >> 7 & 0x01),
        indicesType = flags >> 6 & 0x01,
        bigEndian = (flags >> 5 & 0x01) === 1,
        attributesNumber = flags & 0x1F,
        valuesNumber = 0,
        indicesNumber = 0;

    if (bigEndian) {
        valuesNumber = (array[2] << 16) + (array[3] << 8) + array[4];
        indicesNumber = (array[5] << 16) + (array[6] << 8) + array[7];
    } else {
        valuesNumber = array[2] + (array[3] << 8) + (array[4] << 16);
        indicesNumber = array[5] + (array[6] << 8) + (array[7] << 16);
    }

    if (offset / 4 % 1 !== 0) throw new Error('PRWM decoder: Offset should be a multiple of 4, received ' + offset);
    if (version === 0) throw new Error('PRWM decoder: Invalid format version: 0');
    else if (version !== 1) throw new Error('PRWM decoder: Unsupported format version: ' + version);

    if (!indexedGeometry) {
        if (indicesType !== 0) throw new Error('PRWM decoder: Indices type must be set to 0 for non-indexed geometries');
        else if (indicesNumber !== 0) throw new Error('PRWM decoder: Number of indices must be set to 0 for non-indexed geometries');
    }

    let pos = 8;
    let attributes = {}, attributeName, char, attributeType, cardinality, encodingType,
        normalized, arrayType, values, indices, groups, next, i;

    for (i = 0; i < attributesNumber; i++) {
        attributeName = '';
        while (pos < array.length) {
            char = array[pos];
            pos++;
            if (char === 0) break;
            else attributeName += String.fromCharCode(char);
        }
        flags = array[pos];
        attributeType = flags >> 7 & 0x01;
        normalized = flags >> 6 & 0x01;
        cardinality = (flags >> 4 & 0x03) + 1;
        encodingType = flags & 0x0F;
        arrayType = InvertedEncodingTypes[encodingType];
        pos++;
        pos = Math.ceil(pos / 4) * 4;
        values = copyFromBuffer(buffer, arrayType, pos + offset, cardinality * valuesNumber, bigEndian);
        pos += arrayType.BYTES_PER_ELEMENT * cardinality * valuesNumber;
        attributes[attributeName] = {
            type: attributeType, cardinality: cardinality, values: values, normalized: normalized === 1
        };
    }

    indices = null;
    if (indexedGeometry) {
        pos = Math.ceil(pos / 4) * 4;
        indices = copyFromBuffer(buffer, indicesType === 1 ? Uint32Array : Uint16Array, pos + offset, indicesNumber, bigEndian);
    }

    groups = [];
    pos = Math.ceil(pos / 4) * 4;
    while (pos < array.length) {
        next = read4ByteInt(array, pos);
        if (next === -1) { pos += 4; break; }
        groups.push({
            materialIndex: next,
            start: read4ByteInt(array, pos + 4),
            count: read4ByteInt(array, pos + 8)
        });
        pos += 12;
    }

    return { version: version, attributes: attributes, indices: indices, groups: groups };
}

/** Collect the unique underlying ArrayBuffers of a decoded result, for Worker transfer. */
export function collectTransferables(decoded) {
    const bufs = new Set();
    for (const k in decoded.attributes) bufs.add(decoded.attributes[k].values.buffer);
    if (decoded.indices) bufs.add(decoded.indices.buffer);
    return [...bufs];
}
