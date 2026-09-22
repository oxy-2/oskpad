# OSK Pad

Turns a touchscreen Chromebook into a multi-touch CAD trackpad for your PC.

```
Chromebook (fullscreen web app, multi-touch)
        |  WebSerial over USB  (115200, binary packets)
        v
nRF52840 (CircuitPython, USB CDC -> BLE HID bridge)
        |  Bluetooth LE HID (mouse + keyboard)
        v
Windows PC (Onshape)
```

## Parts

- nRF52840 dev board (tested: Tenstar Pro Micro, nice!nano bootloader identity)
- Chromebook with touchscreen + USB port
- PC with Bluetooth

## Hardware setup (one time)

1. Flash CircuitPython for nice_nano to the board (double-tap reset -> UF2 drag-drop).
2. Copy `firmware/lib/adafruit_ble` + `firmware/lib/adafruit_hid` to `CIRCUITPY/lib/`.
3. Copy `firmware/boot.py` and `firmware/code.py` to `CIRCUITPY/`.
4. Pair "OSK Pad" in Windows Bluetooth settings.
5. Plug the board into the Chromebook.

## Web app

Hosted at: https://oxy-2.github.io/oskpad/

On the Chromebook: open the URL, Connect Pad, pick the serial entry, then install as
an app (menu > Install as app / Add to shelf) and go fullscreen. Works offline after
the first load (service worker).

## Gestures (Onshape)

| Gesture | Sends |
|---|---|
| 1 finger drag | cursor move (gain slider scales it) |
| 1 finger tap | left click |
| 2 finger tap | right click |
| 3 finger tap | middle click |
| 1 finger hold (>320 ms) then drag | left-button drag |
| 2 finger drag | pan (shift + middle) |
| 2 finger pinch | zoom (scroll wheel) |
| 3 finger drag | orbit view (middle-drag) |

Board LED: solid = BLE connected, blinking = advertising.
Board button (P0_09) or replug = restart firmware + re-advertise.
If it ever refuses to pair: Windows Bluetooth > remove OSK Pad > press the button > re-pair.

## Serial protocol (USB CDC data port)

| Byte | Payload | Action |
|---|---|---|
| `0x4D` | int16 LE dx, int16 LE dy | mouse move |
| `0x42` | u8 mask (1=L 2=R 4=M) | buttons |
| `0x57` | s8 delta | scroll wheel |
| `0x53` | u8 on/off | shift hold |
| `0x51` | - | status query -> `0x71 conn pktCount` |

Status broadcasts (`0x71 ...`) are also sent on BLE connect/disconnect.

## Repo layout

- `index.html`, `app.js`, `style.css`, `sw.js`, `manifest.webmanifest` - the web app
- `firmware/` - CircuitPython files for the board
