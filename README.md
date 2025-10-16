# 🔥 PyOdin Web - HTML5 Webapp Port

> A browser-based Samsung firmware flashing tool using WebUSB

[![WebUSB](https://img.shields.io/badge/WebUSB-Enabled-blue.svg)](https://wicg.github.io/webusb/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Browser](https://img.shields.io/badge/browser-Chrome%20%7C%20Edge%20%7C%20Opera-orange.svg)](https://caniuse.com/webusb)

## 🌟 What is PyOdin Web?

PyOdin Web is a complete HTML5/JavaScript port of [PyOdin](../README.md), allowing you to flash Samsung firmware directly from your web browser without installing any software! It uses the **WebUSB API** to communicate directly with Samsung devices in Download Mode.

## ✨ Features

- 🌐 **No Installation Required**: Runs entirely in your web browser
- 🔌 **WebUSB Powered**: Direct USB communication using modern browser APIs
- 📦 **Full Format Support**: TAR, TAR.MD5, TAR.GZ, BIN, IMG files
- 🗜️ **Smart Compression**: Handles GZIP compressed firmware (LZ4 coming soon)
- 📊 **Real-time Progress**: Beautiful progress bars and live logging
- 🎯 **Modern UI**: Responsive, intuitive interface with drag-and-drop
- 🔐 **Safe**: Built-in MD5 verification and safety checks
- 🚀 **Fast**: Efficient streaming and chunked transfers

## 🌍 Browser Requirements

PyOdin Web requires a browser with WebUSB support:

- ✅ **Chrome/Chromium** 61+
- ✅ **Edge** 79+
- ✅ **Opera** 48+
- ❌ Firefox (WebUSB not supported)
- ❌ Safari (WebUSB not supported)

**Recommended**: Latest version of Chrome for best compatibility.

## 🚀 Quick Start

### 1. Serve the Webapp

You need to serve the webapp over HTTPS (required for WebUSB). You have several options:

#### Option A: Simple HTTP Server (Development Only)

```bash
# Python 3
cd webapp
python3 -m http.server 8000

# Then open: http://localhost:8000
# Note: WebUSB may have limitations with http://
```

#### Option B: HTTPS Server (Recommended)

```bash
# Using Node.js http-server with SSL
npm install -g http-server
cd webapp
http-server -S -C cert.pem -K key.pem -p 8443

# Then open: https://localhost:8443
```

#### Option C: Deploy to GitHub Pages

Just push the `webapp` folder to GitHub Pages - it will work over HTTPS automatically!

### 2. Prepare Your Device

1. **Power off** your Samsung device completely
2. **Press and hold**: `Volume Down` + `Bixby/Home` + `Power`
3. When you see a warning, press `Volume Up` to continue
4. You should see **"Downloading... Do not turn off target"** ✅

### 3. Flash Your Firmware

1. Open PyOdin Web in your browser
2. Click **"Connect Device"** and select your Samsung device
3. Click **"Select Firmware File"** or drag-and-drop your firmware
4. Review the firmware information and options
5. Click **"Start Flashing"** and confirm
6. Wait for the flash to complete (device will reboot automatically)

That's it! 🎉

## 📖 Detailed Usage Guide

### Connecting Your Device

The webapp will request permission to access your USB device. This is a browser security feature - you must grant access each time.

**Troubleshooting Connection Issues:**

- Make sure your device is in Download Mode (see instructions above)
- Try a different USB port (USB 2.0 often works better than USB 3.0)
- Use a good quality USB cable (preferably the original cable)
- On Linux, you may need to set up udev rules for USB access
- Close any other software that might be accessing the device (Odin, Heimdall, etc.)

### Loading Firmware

PyOdin Web supports multiple firmware formats:

- **TAR**: Plain TAR archives
- **TAR.MD5**: TAR with MD5 hash (common for Samsung firmware)
- **TAR.GZ**: GZIP compressed TAR archives
- **BIN**: Single binary files
- **IMG**: Single image files

**Firmware File Structure:**

When you load a TAR-based firmware, PyOdin Web will show you all files inside:
- `boot.img` - Kernel/boot partition
- `recovery.img` - Recovery partition
- `system.img` - System partition
- `*.pit` - Partition Information Table (optional)
- And more...

### Flash Options

- **Verify Firmware Hash**: Checks MD5 hash if present in .md5 file
- **Auto Reboot After Flash**: Device will reboot automatically when done
- **Verbose Logging**: Shows detailed technical information in the log

### During Flashing

**What to expect:**
1. Initialization phase (protocol handshake)
2. PIT exchange (partition table information)
3. File transfer (this is the longest part)
4. Verification
5. Reboot (if enabled)

**Important - DO NOT:**
- ❌ Unplug the USB cable
- ❌ Close the browser
- ❌ Power off your device
- ❌ Interact with your device

**Progress Tracking:**

The webapp shows:
- Overall percentage
- Current file being transferred
- Bytes transferred / Total bytes
- Real-time activity log

## ⚠️ Safety & Warnings

### IMPORTANT: Read This First!

Flashing firmware is a powerful operation that can **brick your device** if done incorrectly. Please read and understand these warnings:

### Things That Can Brick Your Device

- ❌ **Wrong Firmware**: Using firmware for a different device model
- ❌ **Power Loss**: Device or computer losing power during flash
- ❌ **Cable Disconnect**: USB cable getting unplugged
- ❌ **Locked Bootloader**: Trying to flash on locked devices
- ❌ **Incompatible PIT**: Using wrong partition table

### Pre-Flash Checklist

Before you flash, make sure:

- ✅ **Backup Everything**: Your photos, contacts, apps, everything!
- ✅ **Charge Device**: At least 70% battery (80%+ recommended)
- ✅ **Good USB Cable**: Use the original cable if possible
- ✅ **Verify Firmware**: Check the firmware is for your EXACT model
- ✅ **Read Instructions**: If the firmware has any special instructions
- ✅ **Stable Power**: Laptop plugged in, desktop on UPS
- ✅ **Stable Internet**: For downloading firmware if needed

### What PyOdin Web Cannot Do

This is a flashing tool, not a magic tool:

- 🚫 Won't unlock your bootloader
- 🚫 Won't bypass OEM/FRP lock
- 🚫 Won't root your device
- 🚫 Won't remove Knox or security features
- 🚫 Won't help with stolen devices

**This tool is for legitimate firmware flashing only.**

## 🔧 Technical Details

### Architecture

```
┌─────────────────────────────────────────┐
│            index.html (UI)              │
└─────────────────────────────────────────┘
                    │
      ┌─────────────┼─────────────┐
      ↓             ↓             ↓
  app.js      flasher.js    download-engine.js
      │             │             │
      └─────────────┼─────────────┘
                    ↓
        ┌───────────────────────┐
        │   USB Communication   │
        │   (WebUSB API)        │
        └───────────────────────┘
                    ↓
        ┌───────────────────────┐
        │   Samsung Device      │
        │   (Download Mode)     │
        └───────────────────────┘
```

### JavaScript Modules

- **constants.js**: Protocol constants and opcodes
- **utils.js**: Utility functions (formatting, packing, etc.)
- **crypto-utils.js**: MD5/SHA256 hashing (uses SparkMD5)
- **usb-device.js**: WebUSB communication wrapper
- **firmware-parser.js**: TAR/GZIP parsing (uses pako.js)
- **pit-parser.js**: Partition Information Table parser
- **download-engine.js**: Odin protocol implementation
- **flasher.js**: High-level flashing orchestration
- **app.js**: UI logic and event handling

### WebUSB API

PyOdin Web uses the [WebUSB API](https://wicg.github.io/webusb/) to communicate directly with USB devices:

```javascript
// Request device access
const device = await navigator.usb.requestDevice({
    filters: [{ vendorId: 0x04E8 }]  // Samsung
});

// Open connection
await device.open();
await device.selectConfiguration(1);
await device.claimInterface(0);

// Transfer data
await device.transferOut(endpointNumber, data);
const result = await device.transferIn(endpointNumber, length);
```

### Protocol Implementation

PyOdin Web implements the Samsung Odin protocol (reverse-engineered from Odin4):

**Command Structure:**
```
[4 bytes] Command (100-105)
[4 bytes] Sub-command
[4 bytes] Parameter
[... ] Additional data
```

**Key Commands:**
- `100`: Device control & setup
- `101`: PIT operations
- `102`: File transfer
- `103`: Session control & reboot

**Transfer Sequence:**
1. Handshake (protocol version negotiation)
2. Initialize connection (send total bytes)
3. PIT exchange (partition information)
4. File transfer (chunked, with progress)
5. Verification
6. Close session
7. Reboot (optional)

## 🛠️ Development

### Project Structure

```
webapp/
├── index.html              # Main HTML file
├── js/
│   ├── constants.js        # Protocol constants
│   ├── utils.js            # Utility functions
│   ├── crypto-utils.js     # Cryptographic functions
│   ├── usb-device.js       # WebUSB wrapper
│   ├── firmware-parser.js  # Firmware parsing
│   ├── pit-parser.js       # PIT handling
│   ├── download-engine.js  # Protocol implementation
│   ├── flasher.js          # Main flasher logic
│   └── app.js              # UI logic
└── README.md               # This file
```

### Adding Dependencies

The webapp includes inline stubs for external libraries. For production, include:

**SparkMD5** (for MD5 hashing):
```html
<script src="https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js"></script>
```

**pako** (for GZIP decompression):
```html
<script src="https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js"></script>
```

### Testing

To test without a real device:

1. Enable USB device mocking in Chrome DevTools
2. Use the WebUSB Test API
3. Create mock device descriptors

### Debugging

Open Chrome DevTools Console to see verbose logging:

```javascript
// Enable verbose mode
flasher.verbose = true;
```

All operations are logged to both the UI and the browser console.

## 🐛 Troubleshooting

### "WebUSB not supported"

**Solution**: Use Chrome 61+, Edge 79+, or Opera 48+. Firefox and Safari don't support WebUSB.

### Device Not Detected

**Possible causes:**
- Device not in Download Mode
- Wrong USB cable
- USB driver issues (Windows)
- Permission issues (Linux)

**Solutions:**
1. Verify Download Mode (screen should say "Downloading...")
2. Try different USB cable/port
3. On Linux: Set up udev rules
4. On Windows: Install Samsung USB drivers

### Flash Fails During Transfer

**Possible causes:**
- Unstable USB connection
- Power loss
- Incompatible firmware
- Device bootloader issues

**Solutions:**
1. Use USB 2.0 port instead of USB 3.0
2. Use original/high-quality USB cable
3. Verify firmware is for your device model
4. Check device battery (>70%)

### Browser Crashes or Freezes

**Possible causes:**
- Large firmware files (>4GB)
- Low system memory
- Browser limitations

**Solutions:**
1. Close other browser tabs/applications
2. Try a different browser (Chrome recommended)
3. Check if firmware file is corrupted

## 📚 Resources

### Official Documentation

- [WebUSB Specification](https://wicg.github.io/webusb/)
- [WebUSB Explainer](https://github.com/WICG/webusb/blob/main/EXPLAINER.md)

### Firmware Sources

- [SamMobile](https://www.sammobile.com/firmwares/) - Official Samsung firmware
- [XDA Forums](https://forum.xda-developers.com/) - Custom ROMs and firmware

### Related Projects

- [PyOdin](https://github.com/pyodin/pyodin) - Original Python implementation
- [Heimdall](https://github.com/Benjamin-Dobell/Heimdall) - Cross-platform Odin alternative
- [JOdin3](https://forum.xda-developers.com/t/jodin3.1710416/) - Java-based Odin

## 🤝 Contributing

Contributions are welcome! To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

### Development Guidelines

- Follow existing code style
- Add comments for complex logic
- Update documentation
- Test on multiple browsers
- Include error handling

## 📄 License

This project is licensed under the MIT License. See LICENSE file for details.

**Disclaimer**: This is an independent implementation and is not affiliated with or endorsed by Samsung Electronics.

## ⚡ Performance Tips

- Use Chrome for best performance
- Close unnecessary browser tabs
- Disable browser extensions during flashing
- Use wired connection (not USB hub)
- Ensure adequate system memory (4GB+ recommended)

## 🔐 Security & Privacy

- All operations happen locally in your browser
- No data is sent to external servers
- Firmware files are processed in-memory
- USB communication is direct (device ↔ browser)

## 💖 Acknowledgments

- Samsung for creating the Odin protocol
- Chrome team for WebUSB API
- PyOdin developers for the original implementation
- Open-source firmware community

## 📞 Support

For issues, questions, or contributions:

- **GitHub Issues**: [Report a bug](https://github.com/pyodin/pyodin/issues)
- **XDA Forums**: [Discussion thread]
- **Documentation**: [Wiki](https://github.com/pyodin/pyodin/wiki)

---

**Made with ❤️ by the PyOdin Developers**

**⚠️ Use at your own risk. Always backup your data before flashing!**

