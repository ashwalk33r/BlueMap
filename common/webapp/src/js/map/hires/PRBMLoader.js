/*
 * This file is part of BlueMap, licensed under the MIT License (MIT).
 *
 * Copyright (c) Blue (Lukas Rieger) <https://bluecolored.de>
 * Copyright (c) Kevin Chapelier <https://github.com/kchapelier>
 * Copyright (c) contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * Adapted version of PRWM by Kevin Chapelier
 * See https://github.com/kchapelier/PRWM for more informations about this file format
 */

import {
    DefaultLoadingManager,
    FileLoader,
    BufferGeometry,
    BufferAttribute,
    FloatType
} from "three"
import { decodePrwm, isBigEndianPlatform } from "./prbmDecode.js"
import { getPrbmWorkerPool } from "./prbmWorkerPool.js"

"use strict";

/** Build a BufferGeometry from a decoded PRWM result (must run on the main thread). */
function buildGeometry( decoded ) {
    let bufferGeometry = new BufferGeometry(),
        attributesKey = Object.keys( decoded.attributes ),
        attribute, bufferAttribute, i;

    for ( i = 0; i < attributesKey.length; i++ ) {
        attribute = decoded.attributes[ attributesKey[ i ] ];
        bufferAttribute = new BufferAttribute( attribute.values, attribute.cardinality, attribute.normalized );
        bufferAttribute.gpuType = FloatType;
        bufferGeometry.setAttribute( attributesKey[ i ], bufferAttribute );
    }

    if ( decoded.indices !== null ) {
        bufferGeometry.setIndex( new BufferAttribute( decoded.indices, 1 ) );
    }

    bufferGeometry.groups = decoded.groups;

    return bufferGeometry;
}

export class PRBMLoader {

    // Offload the CPU-bound PRWM decode to a Web Worker pool when available.
    // Toggled from settings.json (tileParseInWorker); falls back to sync decode.
    static useWorker = true;

    constructor ( manager ) {
        this.manager = ( manager !== undefined ) ? manager : DefaultLoadingManager;
    }

    load ( url, onLoad, onProgress, onError ) {
        let scope = this;

        url = url.replace( /\*/g, isBigEndianPlatform() ? 'be' : 'le' );

        let loader = new FileLoader( scope.manager );
        loader.setPath( scope.path );
        loader.setResponseType( 'arraybuffer' );

        loader.load( url, function ( arrayBuffer ) {
            onLoad( scope.parse( arrayBuffer ) );
        }, onProgress, onError );
    }

    setPath ( value ) {
        this.path = value;
        return this;
    }

    /** Synchronous decode + geometry build (main thread). */
    parse ( arrayBuffer, offset ) {
        return buildGeometry( decodePrwm( arrayBuffer, offset ) );
    }

    /**
     * Decode off the main thread when a worker pool is available, then build the
     * geometry on the main thread. Falls back to synchronous parse otherwise.
     * NOTE: transfers arrayBuffer to the worker — the caller must not reuse it.
     * @returns {Promise<BufferGeometry>}
     */
    async parseAsync ( arrayBuffer, offset ) {
        if ( PRBMLoader.useWorker ) {
            const pool = getPrbmWorkerPool();
            if ( pool ) {
                const decoded = await pool.parse( arrayBuffer, offset || 0 );
                return buildGeometry( decoded );
            }
        }
        return this.parse( arrayBuffer, offset );
    }

    isBigEndianPlatform () {
        return isBigEndianPlatform();
    }

}
