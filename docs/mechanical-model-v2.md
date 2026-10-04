# AstroBone Reduced-Order Mechanical Model V2

Status: equation and validation specification; not active in the app
Date: 2026-08-26

## Purpose

V2 replaces the one-mode nominal contact-stress comparison with a transparent
beam-section model that resolves axial force, bending, transverse shear, and
torsion. It remains a reduced-order research model. It is not FEA, a fracture
propagation model, or a patient-specific tibia simulation.

## Coordinate Contract

Use a right-handed tibia-local frame:

- `e_z`: tibial shaft axis
- `e_x`, `e_y`: principal cross-section directions
- `r`: vector from the evaluated cross-section centroid to the contact point
- `F`: average transferred force vector in the same frame

The existing surface-angle convention remains valid for the contact calculation:

```text
theta_surface = 0 degrees   -> glancing contact
theta_surface = 90 degrees  -> normal contact
v_normal = v * sin(theta_surface)
```

This angle alone cannot determine axial and transverse bone loading. V2 also
requires the force direction relative to the shaft frame.

## Event Reconstruction

If a force-time history is measured, use it directly. Otherwise, the provisional
average-force reconstruction is:

```text
v_normal = v * sin(theta_surface)
J_normal = k_transfer * m * v_normal
F_average = J_normal / delta_t
F = F_average * e_force
```

`k_transfer` represents restitution, suit attenuation, soft tissue, and tool
compliance only when a justified distribution exists. Setting `k_transfer = 1`
recovers the V1 no-rebound/no-attenuation assumption.

## Section Resultants

```text
N   = dot(F, e_z)
V_x = dot(F, e_x)
V_y = dot(F, e_y)
V   = sqrt(V_x^2 + V_y^2)

M_vector = cross(r, F)
T   = dot(M_vector, e_z)
M_x = dot(M_vector, e_x)
M_y = dot(M_vector, e_y)
```

This decomposition is an equilibrium calculation. Boundary reactions and joint
constraints are not resolved; the evaluated section and support assumptions must
be named in every scenario.

## Nominal Stress Demands

For an orthogonal principal-axis section:

```text
sigma_axial = N / A_b
sigma_bending_bound = abs(M_x) * c_y / I_x + abs(M_y) * c_x / I_y

sigma_tension_demand = max(0, sigma_axial + sigma_bending_bound)
sigma_compression_demand = max(0, -sigma_axial + sigma_bending_bound)

tau_transverse = kappa * V / A_b
tau_torsion = abs(T) * c_t / J_t
tau_demand_bound = tau_transverse + tau_torsion
```

The sums are conservative outer-fiber bounds, not a reconstructed local stress
field. `kappa` is a cross-section shear factor. `J_t` must be identified as a
Saint-Venant torsion constant or an explicitly labeled polar approximation.

## Capacity State

Keep capacity modes separate:

```text
C_t_adjusted = C_t0 * S_mission * S_person * S_site
C_c_adjusted = C_c0 * S_mission * S_person * S_site
C_s_adjusted = C_s0 * S_mission * S_person * S_site
```

The first V2 study may use the same uncertain modifier for all three modes only
as a declared approximation. BMD loss must not be applied one-for-one as strength
loss. Human HR-pQCT/micro-FE estimated failure-load change is a better provisional
anchor, but it still transfers distal-tibia axial evidence to a shaft-impact model.

## Relative Mechanical Risk Index

Define component utilization without converting it to injury probability:

```text
U_tension = sigma_tension_demand / C_t_adjusted
U_compression = sigma_compression_demand / C_c_adjusted
U_shear = tau_demand_bound / C_s_adjusted

RI = max(U_tension, U_compression, U_shear)
governing_mode = argmax(U_tension, U_compression, U_shear)
```

`RI >= 1` means at least one modeled nominal demand equals or exceeds its modeled
capacity under the stated assumptions. It does not mean that a fracture occurred.
The maximum-component rule is deliberately inspectable and avoids an unsupported
cross-mode interaction formula. A validated interaction criterion can replace it
later under a new model version.

## Why This Is More Defensible Than V1

- Axial force and transverse force are no longer conflated with contact pressure.
- Contact eccentricity creates bending and torsion explicitly.
- Tension, compression, and shear no longer share one scalar capacity.
- Geometry is visible in the model contract instead of hidden in a stress proxy.
- The governing loading mode is explainable to a reviewer.

It is still limited by average-force reconstruction, simple supports, nominal
section stresses, uncertain material transfer, and absent soft-tissue dynamics.

## Monte Carlo V2 Contract

Sample epistemic and aleatory terms separately where the evidence supports that
distinction. At minimum, record distribution family, bounds, source, random seed,
and whether each term is measured, reconstructed, or assumed.

Required outputs:

```text
median RI
5th-95th percentile RI interval
P(RI >= 1 | model, scenario, distributions)
governing-mode fractions
rank correlation and a variance-based sensitivity measure
Monte Carlo convergence trace
```

The phrase "modeled capacity-exceedance probability" is permitted only with the
conditional notation and assumptions visible nearby.

## Verification Matrix

| Test | Expected result |
| --- | --- |
| Zero force | All resultants, stresses, utilizations, and RI are zero |
| Force parallel to shaft through centroid | Axial demand only |
| Transverse force through centroid | Transverse shear only; no moment |
| Transverse eccentric force | Shear plus bending/torsion according to `cross(r, F)` |
| Reverse axial direction | Tension and compression modes swap |
| Double force | All nominal demands and utilizations double |
| Double bending lever arm | Bending demand doubles; axial demand is unchanged |
| Double torsional eccentricity | Torsional demand doubles |
| Increase any capacity | Its component utilization decreases monotonically |
| Analytical vs MATLAB vs Simulink | Component outputs agree within frozen numerical tolerance |

## Activation Gates

V2 must not replace V1 in the public app until:

1. all geometry and mode-specific capacities in the parameter table are sourced;
2. hand calculations and automated tests pass;
3. MATLAB reproduces the JavaScript reference cases;
4. Simulink reproduces the frozen MATLAB cases;
5. Monte Carlo distributions pass a source review and convergence check;
6. one independent biomechanics or controlled physical benchmark is documented;
7. all public labels and exports use the V2 claim boundary.

## External Benchmarks, Not Imported Thresholds

NASA BFxRM provides precedent for separating applied load, skeletal strength,
uncertainty, and an applied-load-to-strength index. The automotive Tibia Index
provides precedent for combining axial force and bending moment. AstroBone does
not import BFxRM probability mapping or crash-dummy critical values because the
population, anatomy, boundary conditions, and event class differ.

Sources:

- https://ntrs.nasa.gov/citations/20170005223
- https://www.nhtsa.gov/document/17esv457pdf
- https://pubmed.ncbi.nlm.nih.gov/10912351/
- https://pmc.ncbi.nlm.nih.gov/articles/PMC2736133/
- https://pmc.ncbi.nlm.nih.gov/articles/PMC3552154/
- https://pubmed.ncbi.nlm.nih.gov/11052385/
- https://pmc.ncbi.nlm.nih.gov/articles/PMC8862023/
