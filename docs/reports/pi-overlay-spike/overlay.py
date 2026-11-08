#!/usr/bin/env python3
"""
The overlay: a second Wayland surface (layer-shell, TOP layer) that paints a
scenery image over a rectangle of the screen at 50% opacity and lets input
pass through. This is the Phase 2 mechanism under test - the compositor
layers it above whatever the browser draws, DRM video included, and the
page cannot see it.

Usage: overlay.py X Y W H [image.jpg] [opacity]
"""
import sys, os, gi
gi.require_version("Gtk", "3.0")
gi.require_version("GtkLayerShell", "0.1")
from gi.repository import Gtk, Gdk, GtkLayerShell, GdkPixbuf, GLib
import cairo

x, y, w, h = (int(v) for v in sys.argv[1:5])
img = sys.argv[5] if len(sys.argv) > 5 else ""
opacity = float(sys.argv[6]) if len(sys.argv) > 6 else 0.5

win = Gtk.Window()
GtkLayerShell.init_for_window(win)
GtkLayerShell.set_layer(win, GtkLayerShell.Layer.TOP)
for edge in (GtkLayerShell.Edge.LEFT, GtkLayerShell.Edge.TOP):
    GtkLayerShell.set_anchor(win, edge, True)
GtkLayerShell.set_margin(win, GtkLayerShell.Edge.LEFT, x)
GtkLayerShell.set_margin(win, GtkLayerShell.Edge.TOP, y)
GtkLayerShell.set_exclusive_zone(win, -1)          # never push other surfaces around
GtkLayerShell.set_keyboard_mode(win, GtkLayerShell.KeyboardMode.NONE)
win.set_default_size(w, h)
win.set_app_paintable(True)
screen = win.get_screen()
visual = screen.get_rgba_visual()
if visual: win.set_visual(visual)

pix = None
if img and os.path.exists(img):
    pix = GdkPixbuf.Pixbuf.new_from_file_at_scale(img, w, h, False)

def draw(widget, cr):
    cr.set_operator(cairo.OPERATOR_SOURCE)
    cr.set_source_rgba(0, 0, 0, 0)
    cr.paint()
    cr.set_operator(cairo.OPERATOR_OVER)
    if pix:
        Gdk.cairo_set_source_pixbuf(cr, pix, 0, 0)
        cr.paint_with_alpha(opacity)
    else:
        cr.set_source_rgba(0.94, 0.66, 0.24, opacity)   # Prism accent as a stand-in
        cr.rectangle(0, 0, w, h); cr.fill()
    # a moving marker so a screenshot proves the overlay is live, not a stale frame
    t = GLib.get_monotonic_time() / 1e6
    cr.set_source_rgba(1, 1, 1, 0.9)
    cr.arc(20 + (t * 60) % max(1, w - 40), h - 20, 8, 0, 6.2832); cr.fill()
    return False

da = Gtk.DrawingArea()
da.connect("draw", draw)
win.add(da)
win.connect("destroy", Gtk.main_quit)
win.show_all()
# click-through: an empty input region
win.get_window().input_shape_combine_region(cairo.Region(), 0, 0)
GLib.timeout_add(50, lambda: (da.queue_draw(), True)[1])
print(f"overlay up at {x},{y} {w}x{h} opacity={opacity} img={img or '(solid)'}", flush=True)
Gtk.main()
