# PyOdin Web - Recent Fixes

## Handshake Fix (Main Issue)

### Problem
The handshake was failing because the code was sending structured command packets instead of the literal string "ODIN".

### Solution
Changed the handshake to send the exact 4-byte sequence:
- **Send**: `"ODIN"` (0x4F 0x44 0x49 0x4E)
- **Receive**: `"LOKE"` (0x4C 0x4F 0x4B 0x45)

### Files Changed
- `js/download-engine.js` - Fixed handshake() method

## Protocol Version Stall Fix

### Problem
After successful handshake, the device was stalling when trying to get protocol version.

### Root Causes
1. **Wrong packet size**: Using 512 bytes instead of 1024 bytes
2. **Timeout handling**: WebUSB doesn't support timeouts natively
3. **Missing diagnostics**: Hard to debug what was happening

### Solutions

#### 1. Packet Size Fix
```javascript
// Before
this.packetSize = 512;

// After
this.packetSize = 1024;  // CRITICAL: Must be 1024 for command packets
```

**Why**: The Odin protocol requires 1024-byte command packets (from odin4.c decompilation).

#### 2. Timeout Implementation
Added proper timeout handling with Promise.race():
```javascript
const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('timeout')), timeoutMs);
});

const result = await Promise.race([readPromise, timeoutPromise]);
```

**Why**: WebUSB's `transferIn` doesn't have a timeout parameter, so we implement one manually.

#### 3. Better Logging
Added step-by-step logging:
```javascript
this.log("Step 1: Handshake...");
this.log("Step 2: Getting protocol version (100/0/4)...");
this.log("Step 3: Sending file part size (100/5)...");
```

### Files Changed
- `js/download-engine.js` - Changed packetSize to 1024
- `js/usb-device.js` - Fixed timeout handling in read/write methods
- `js/flasher.js` - Added detailed logging

## Testing Results

### ✅ Working
- Device detection
- USB connection
- Handshake (ODIN → LOKE)

### ⏳ Next to Test
- Protocol version detection
- File transfer
- Full flash operation

## Common Issues & Solutions

### Issue: "Failed handshake"
**Cause**: Device not in Download Mode or wrong USB settings
**Solution**: 
1. Verify device shows "Downloading..." on screen
2. Try different USB port (USB 2.0 preferred)
3. Use original/quality USB cable

### Issue: Stalls after handshake
**Cause**: Wrong packet size (512 vs 1024)
**Solution**: Fixed in this update - uses 1024-byte packets

### Issue: Timeout errors
**Cause**: Device taking longer than expected
**Solution**: 
1. Timeouts increased to 60 seconds
2. WebUSB timeout properly implemented
3. Check verbose logs for details

## Protocol Sequence

The correct Odin protocol sequence (from odin4.c):

```
1. Handshake
   - Send: "ODIN" (4 bytes)
   - Recv: "LOKE" (4 bytes)

2. Get Protocol Version (100/0/4)
   - Send: [cmd=100, sub=0, param=4] in 1024-byte packet
   - Recv: [version, packet_size] in response

3. Set File Part Size (100/5) [if supported]
   - Send: [cmd=100, sub=5, param=0x100000] (1MB)
   - Recv: [status]

4. Initialize Session (100/2)
   - Send: [cmd=100, sub=2, total_bytes=N]
   - Recv: [status]

5. Send PIT Info (101/1) [for protocol v2/v3]
   - Send: [cmd=101, sub=1]
   - Recv: [status]

6. Receive PIT (101/1)
   - Request PIT data
   - Recv: PIT bytes

7. Transfer Files (102/0)
   - For each file:
     - Send: [cmd=102, sub=0, size=N, filename]
     - Send: file data in chunks
     - Recv: [verification status]

8. Close Session (103/0)
   - Send: [cmd=103, sub=0]
   - Recv: [status]

9. Reboot (103/1) [optional]
   - Send: [cmd=103, sub=1]
   - Device disconnects
```

## Key Constants

```javascript
// From constants.js
SAMSUNG_VENDOR_ID = 0x04E8
SAMSUNG_DOWNLOAD_MODE_PIDS = [0x685D, 0x68C3]

TIMEOUT_HANDSHAKE = 60  // seconds
TIMEOUT_TRANSFER = 60   // seconds

// Packet sizes
USB_PACKET_SIZE = 512          // USB endpoint packet size
COMMAND_PACKET_SIZE = 1024     // Odin command packet size
FILE_TRANSFER_CHUNK = 0x100000 // 1MB file transfer chunks
```

## Next Steps

1. Test protocol version response
2. Verify PIT exchange
3. Test small firmware file
4. Test full firmware flash
5. Add more error recovery
6. Optimize large file transfers

## Debugging Tips

### Enable Verbose Logging
```javascript
// In browser console:
flasher.verbose = true;
```

### View USB Traffic
Use Chrome's `chrome://device-log` to see raw USB transfers.

### Common Log Patterns

**Successful Handshake:**
```
[DownloadEngine] Performing handshake...
[DownloadEngine] Sent 'ODIN', waiting for 'LOKE'...
[DownloadEngine] Received: 'LOKE' (76, 79, 75, 69)
[DownloadEngine] ✓ Handshake OK (received 'LOKE')
```

**Successful Protocol Version:**
```
[OdinFlasher] Step 2: Getting protocol version (100/0/4)...
[OdinFlasher] Sending 1024 byte packet...
[OdinFlasher] Received 8 bytes
[OdinFlasher] Response: cmd=100, data=0x00030200
[OdinFlasher] ✓ Protocol version: 3, default packet size: 512
```

## References

- Original Python implementation: `pyodin/download_engine.py`
- Odin4 decompiled source: Comments throughout code
- WebUSB spec: https://wicg.github.io/webusb/

