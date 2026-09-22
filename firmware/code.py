import time
import struct
import supervisor
import board
import digitalio
import usb_cdc

import adafruit_ble
from adafruit_ble.advertising.standard import ProvideServicesAdvertisement
from adafruit_ble.services.standard.hid import HIDService
from adafruit_hid.mouse import Mouse
from adafruit_hid.keyboard import Keyboard
from adafruit_hid.keycode import Keycode

DEVICE_NAME = "OSK Pad"

BUTTON_PIN_NAME = None
button = None
for name in ("D9", "P0_09", "D1", "P0_06"):
    pin = getattr(board, name, None)
    if pin is None:
        continue
    try:
        button = digitalio.DigitalInOut(pin)
        button.direction = digitalio.Direction.INPUT
        button.pull = digitalio.Pull.UP
        BUTTON_PIN_NAME = name
        break
    except Exception:
        button = None

led = None
for name in ("LED", "D13", "BLUE_LED"):
    pin = getattr(board, name, None)
    if pin is None:
        continue
    try:
        led = digitalio.DigitalInOut(pin)
        led.direction = digitalio.Direction.OUTPUT
    except Exception:
        led = None

DIAG = button is not None and not button.value

ble = adafruit_ble.BLERadio()
try:
    ble.name = DEVICE_NAME
except Exception as e:
    print("name set err:", repr(e))
try:
    ble.tx_power = 0
    print("tx_power:", ble.tx_power)
except Exception as e:
    print("tx_power err:", repr(e))
hid = HIDService()
adv = ProvideServicesAdvertisement(hid)
adv.complete_name = DEVICE_NAME
mouse = Mouse(hid.devices)
kbd = Keyboard(hid.devices)

BTN_L = getattr(Mouse, "LEFT_BUTTON", 1)
BTN_R = getattr(Mouse, "RIGHT_BUTTON", 2)
BTN_M = getattr(Mouse, "MIDDLE_BUTTON", 4)

serial = usb_cdc.data

SIZES = {0x4D: 4, 0x42: 1, 0x57: 1, 0x53: 1, 0x52: 0, 0x51: 0}
buf = bytearray()
buttons = 0
shift = False
pkt_count = 0

def status_send(connected):
    try:
        serial.write(bytes((0x71, 1 if connected else 0, pkt_count & 0xFF)))
    except Exception:
        pass

def do_move(dx, dy):
    while dx or dy:
        sx = dx
        if sx > 100:
            sx = 100
        elif sx < -100:
            sx = -100
        sy = dy
        if sy > 100:
            sy = 100
        elif sy < -100:
            sy = -100
        mouse.move(x=sx, y=sy)
        dx -= sx
        dy -= sy

def set_buttons(mask):
    global buttons
    mask &= 0x07
    if mask == buttons:
        return
    on = mask & ~buttons
    off = buttons & ~mask
    if on:
        mouse.press(on)
    if off:
        mouse.release(off)
    buttons = mask

def set_shift(state):
    global shift
    if state == shift:
        return
    if state:
        kbd.press(Keycode.SHIFT)
    else:
        kbd.release(Keycode.SHIFT)
    shift = state

def s8(v):
    return v - 256 if v > 127 else v

def handle(cmd, payload):
    global pkt_count
    if cmd == 0x52:
        print("reload (pair mode)")
        status_send(False)
        time.sleep(0.2)
        supervisor.reload()
        return
    pkt_count += 1
    if not ble.connected:
        return
    if cmd == 0x4D:
        dx, dy = struct.unpack("<hh", payload)
        do_move(dx, dy)
    elif cmd == 0x42:
        set_buttons(payload[0])
    elif cmd == 0x57:
        mouse.move(wheel=s8(payload[0]))
    elif cmd == 0x53:
        set_shift(payload[0] != 0)
    elif cmd == 0x51:
        status_send(ble.connected)

def pump():
    global buf, pump_err_t
    try:
        waiting = serial.in_waiting
        if waiting:
            buf.extend(serial.read(waiting))
    except Exception as e:
        if time.monotonic() - pump_err_t > 2:
            pump_err_t = time.monotonic()
            print("pump err:", repr(e))
        return
    while buf:
        cmd = buf[0]
        size = SIZES.get(cmd)
        if size is None:
            buf = buf[1:]
            continue
        if len(buf) < 1 + size:
            return
        payload = bytes(buf[1:1 + size])
        buf = buf[1 + size:]
        try:
            handle(cmd, payload)
        except Exception as e:
            print("handle err:", repr(e))

advertising = False
adv_started = 0.0
pump_err_t = 0.0
led_t = 0.0
hb_t = 0.0
print("OSK PAD READY name:", DEVICE_NAME)
print("button pin:", BUTTON_PIN_NAME or "none", "led:", led is not None, "diag:", DIAG)

while True:
    try:
        if DIAG:
            now = time.monotonic()
            if now - hb_t > 2.0:
                hb_t = now
                try:
                    serial.write(("OSKDIAG alive t=%d\n" % int(now)).encode())
                except Exception:
                    pass
                print("OSKDIAG alive t=%d" % int(now))
            pump()
            if led is not None:
                led.value = False
        else:
            conn = ble.connected
            if conn and advertising:
                ble.stop_advertising()
                advertising = False
                print("host connected")
                status_send(True)
            if not conn and not advertising:
                try:
                    ble.start_advertising(adv)
                    advertising = True
                    adv_started = time.monotonic()
                    print("advertising")
                    status_send(False)
                except Exception as e:
                    print("adv err:", repr(e))
                    time.sleep(1)
            elif advertising and not conn and time.monotonic() - adv_started > 20:
                try:
                    ble.stop_advertising()
                except Exception:
                    pass
                advertising = False
                print("adv watchdog: restarting advertising")
            pump()
            if button is not None and not button.value:
                time.sleep(0.05)
                if not button.value:
                    print("button -> reload")
                    status_send(False)
                    supervisor.reload()
            if led is not None:
                if conn:
                    led.value = True
                else:
                    now = time.monotonic()
                    if now - led_t > 1.0:
                        led_t = now
                    led.value = (now - led_t) < 0.05
    except Exception as e:
        print("loop err:", repr(e))
        time.sleep(0.1)
    time.sleep(0.005)
