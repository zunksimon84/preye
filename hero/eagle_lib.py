"""
Eagle silhouette, soaring, seen from below.

What makes a shape read as *eagle* rather than as generic bird is a short list
and none of it is detail for its own sake: splayed primary feathers at the
wingtips (the "fingers"), a broad squared tail, a head that protrudes far
enough to be seen, and a shallow dihedral. Miss the fingers and it reads as a
gull no matter how careful the rest is.

Built from overlapping polygons in one ink rather than one closed outline —
far easier to keep each part in proportion.
"""
import math

N_FINGERS = 5


def eagle_polys(cx, cy, span, flap=0.0, bank=0.0, head_turn=0.0):
    """
    One closed outline for head, body, wings and tail, mirrored about the
    centreline, plus the primaries as separate slivers at each tip.

    Assembling this from overlapping parts kept producing a head that looked
    stuck on and a tail that looked like a skirt; a single contour has no seams
    to give away.
    """
    s = span / 2.0          # half span
    b = span * 0.30         # body length unit

    def lift(u):
        return -flap * (max(0.0, u - 0.18) / 0.82) ** 1.6

    def dihedral(u):
        return -0.11 * u ** 1.25

    # x in half-spans, y in body lengths. Runs head → wing → tail down one
    # side; u is the span fraction used for flap and dihedral.
    half = [
        (0.000, -0.86, 0.00),   # head tip
        (0.050, -0.76, 0.00),
        (0.072, -0.60, 0.00),
        (0.082, -0.46, 0.06),   # shoulder
        (0.220, -0.44, 0.22),   # leading edge
        (0.420, -0.46, 0.42),
        (0.545, -0.42, 0.55),   # wrist, front
        (0.585, -0.22, 0.58),   # cap — the tip itself is all primaries
        (0.545, 0.04, 0.55),    # wrist, rear
        (0.420, 0.20, 0.42),    # trailing edge
        (0.220, 0.30, 0.22),
        (0.100, 0.34, 0.10),    # wing root, rear
        (0.092, 0.46, 0.00),    # flank
        (0.165, 0.88, 0.00),    # tail corner, fanned well past the body
        (0.152, 1.04, 0.00),
        (0.000, 1.05, 0.00),    # tail centre
    ]

    def side_pts(side):
        out = []
        for x, y, u in half:
            out.append((side * x * s, (y + lift(u) + dihedral(u)) * b))
        return out

    right = side_pts(1)
    left = side_pts(-1)
    outline = right + list(reversed(left[1:-1]))

    def fingers(side):
        out = []
        for i in range(N_FINGERS):
            f = i / (N_FINGERS - 1.0)
            root_u = 0.54
            root_y = (-0.34 + f * 0.40 + lift(root_u) + dihedral(root_u)) * b
            ang = math.radians(4 + f * 54)
            length = (0.46 - 0.17 * f) * s
            halfw = (0.046 - 0.014 * f) * s
            rx = side * root_u * s
            dx = math.cos(ang) * length * side
            dy = math.sin(ang) * length
            nx, ny = -dy, dx * side
            nl = math.hypot(nx, ny) or 1.0
            nx, ny = nx / nl * halfw, ny / nl * halfw
            out.append([
                (rx + nx, root_y + ny),
                (rx + dx + nx * 0.20, root_y + dy + ny * 0.20),
                (rx + dx - nx * 0.20, root_y + dy - ny * 0.20),
                (rx - nx, root_y - ny),
            ])
        return out

    parts = [outline] + fingers(1) + fingers(-1)

    ca, sa = math.cos(bank), math.sin(bank)
    return [[(cx + px * ca - py * sa, cy + px * sa + py * ca) for px, py in part]
            for part in parts]
