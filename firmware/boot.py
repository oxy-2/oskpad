import usb_cdc
import usb_hid

try:
    import usb_midi
    usb_midi.disable()
except ImportError:
    pass
try:
    import usb_audio
    usb_audio.disable()
except ImportError:
    pass

usb_hid.disable()
usb_cdc.enable(console=True, data=True)
