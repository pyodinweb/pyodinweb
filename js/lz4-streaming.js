/**
 * Streaming LZ4 Decompressor
 * Decompresses LZ4 frames block-by-block without loading entire file into memory
 * 
 * LZ4 Frame Format:
 * - Magic Number (4 bytes): 0x184D2204
 * - Frame Descriptor
 * - Data Blocks
 * - EndMark (4 bytes): 0x00000000
 * - Optional Checksum
 */

class StreamingLZ4Decoder {
    constructor(verbose = false) {
        this.verbose = verbose;
    }
    
    log(message) {
        if (this.verbose) {
            console.log(`[LZ4Stream] ${message}`);
        }
    }
    
    /**
     * Decompress LZ4 file from TAR, calling callback with decompressed chunks
     * @param {File} tarFile - The TAR file handle
     * @param {number} offset - Offset of LZ4 file within TAR
     * @param {number} compressedSize - Size of compressed LZ4 file
     * @param {Function} onChunk - Callback(decompressedChunk) for each decompressed block
     * @returns {Promise<number>} Total decompressed size
     */
    async decompressStreaming(tarFile, offset, compressedSize, onChunk) {
        this.log(`Starting streaming decompression of ${formatBytes(compressedSize)} from offset ${offset}`);
        
        let fileOffset = offset;
        const endOffset = offset + compressedSize;
        let totalDecompressed = 0;
        
        // Read and verify magic number
        const magicBlob = tarFile.slice(fileOffset, fileOffset + 4);
        const magicBuffer = await magicBlob.arrayBuffer();
        const magicView = new DataView(magicBuffer);
        const magic = magicView.getUint32(0, true);
        
        if (magic !== 0x184D2204) {
            throw new Error(`Invalid LZ4 magic number: 0x${magic.toString(16)}`);
        }
        
        this.log('✓ Valid LZ4 magic number');
        fileOffset += 4;
        
        // Parse frame descriptor
        const fdBlob = tarFile.slice(fileOffset, fileOffset + 16);
        const fdBuffer = await fdBlob.arrayBuffer();
        const fdView = new Uint8Array(fdBuffer);
        
        const flg = fdView[0];
        const bd = fdView[1];
        
        const version = (flg >> 6) & 0x3;
        const blockIndependence = (flg >> 5) & 0x1;
        const blockChecksum = (flg >> 4) & 0x1;
        const contentSize = (flg >> 3) & 0x1;
        const contentChecksum = (flg >> 2) & 0x1;
        const dictID = flg & 0x1;
        
        const blockMaxSize = ((bd >> 4) & 0x7);
        const blockSizeTable = [0, 0, 0, 0, 64*1024, 256*1024, 1024*1024, 4*1024*1024];
        const maxBlockSize = blockSizeTable[blockMaxSize];
        
        this.log(`Frame: version=${version}, blockIndep=${blockIndependence}, maxBlockSize=${formatBytes(maxBlockSize)}`);
        
        let fdSize = 2;
        if (contentSize) fdSize += 8;
        if (dictID) fdSize += 4;
        fdSize += 1; // HC byte
        
        fileOffset += fdSize;
        
        // Process data blocks
        let blockNum = 0;
        
        while (fileOffset < endOffset) {
            // Read block size (4 bytes)
            const blockSizeBlob = tarFile.slice(fileOffset, fileOffset + 4);
            const blockSizeBuffer = await blockSizeBlob.arrayBuffer();
            const blockSizeView = new DataView(blockSizeBuffer);
            const blockSize = blockSizeView.getUint32(0, true);
            
            fileOffset += 4;
            
            // Check for EndMark
            if (blockSize === 0) {
                this.log('✓ Reached EndMark');
                break;
            }
            
            // Check if block is compressed
            const isUncompressed = (blockSize & 0x80000000) !== 0;
            const actualBlockSize = blockSize & 0x7FFFFFFF;
            
            if (actualBlockSize > maxBlockSize) {
                throw new Error(`Block size ${actualBlockSize} exceeds max ${maxBlockSize}`);
            }
            
            this.log(`Block ${blockNum}: ${isUncompressed ? 'uncompressed' : 'compressed'} ${formatBytes(actualBlockSize)}`);
            
            // Read block data
            const blockBlob = tarFile.slice(fileOffset, fileOffset + actualBlockSize);
            const blockBuffer = await blockBlob.arrayBuffer();
            const blockData = new Uint8Array(blockBuffer);
            
            fileOffset += actualBlockSize;
            
            // Skip block checksum if present
            if (blockChecksum) {
                fileOffset += 4;
            }
            
            // Decompress or copy block
            let decompressed;
            
            if (isUncompressed) {
                decompressed = blockData;
            } else {
                // Decompress this block
                decompressed = this.decompressBlock(blockData, maxBlockSize);
            }
            
            // Send decompressed data immediately
            await onChunk(decompressed);
            
            totalDecompressed += decompressed.length;
            blockNum++;
            
            // Clear memory
            decompressed = null;
            
            // Progress update
            const percent = ((fileOffset - offset) / compressedSize) * 100;
            this.log(`Progress: ${percent.toFixed(1)}% (${formatBytes(fileOffset - offset)} / ${formatBytes(compressedSize)})`);
        }
        
        this.log(`✓ Decompression complete: ${blockNum} blocks, ${formatBytes(totalDecompressed)} total`);
        
        return totalDecompressed;
    }
    
    /**
     * Decompress a single LZ4 block
     * @param {Uint8Array} src - Compressed block data
     * @param {number} maxSize - Maximum decompressed size
     * @returns {Uint8Array} Decompressed data
     */
    decompressBlock(src, maxSize) {
        const dst = new Uint8Array(maxSize);
        let srcPos = 0;
        let dstPos = 0;
        
        while (srcPos < src.length) {
            // Read token
            const token = src[srcPos++];
            
            // Literal length
            let literalLength = token >> 4;
            if (literalLength === 15) {
                let len;
                do {
                    len = src[srcPos++];
                    literalLength += len;
                } while (len === 255);
            }
            
            // Copy literals
            if (literalLength > 0) {
                for (let i = 0; i < literalLength; i++) {
                    dst[dstPos++] = src[srcPos++];
                }
            }
            
            // Check for end of block
            if (srcPos >= src.length) {
                break;
            }
            
            // Read offset (little-endian)
            const offset = src[srcPos] | (src[srcPos + 1] << 8);
            srcPos += 2;
            
            if (offset === 0) {
                throw new Error('Invalid offset (0)');
            }
            
            // Match length
            let matchLength = (token & 0xF) + 4;
            if ((token & 0xF) === 15) {
                let len;
                do {
                    len = src[srcPos++];
                    matchLength += len;
                } while (len === 255);
            }
            
            // Copy match
            let matchPos = dstPos - offset;
            
            if (matchPos < 0) {
                throw new Error(`Invalid match position: ${matchPos}`);
            }
            
            // Handle overlapping copies
            for (let i = 0; i < matchLength; i++) {
                dst[dstPos++] = dst[matchPos++];
            }
        }
        
        // Return only the filled portion
        return dst.slice(0, dstPos);
    }
}

// Make it globally available
if (typeof window !== 'undefined') {
    window.StreamingLZ4Decoder = StreamingLZ4Decoder;
}

