# Physiome Reference Model

`windkessel.py` is the unmodified generated Python from the IUPS Physiome
Model Repository, "Lumped-parameter cardiovascular model with Windkessel
after-load": https://models.physiomeproject.org/e/43/MainWindKessel.cellml

Downloaded from the exposure's `@@cellml_codegen/Python/raw` endpoint.
`Units.cellml` is from workspace revision
`a47dc58c5d9bfff363de6a4ab2528d4513640d76`.

License: Creative Commons Attribution 3.0 Unported.
https://models.physiomeproject.org/e/43/MainWindKessel.cellml/license_citation
https://creativecommons.org/licenses/by/3.0/

AstroBone's separate build script solves the unchanged rate equations with
SciPy LSODA, changes only the cycle period for reference presets, converts
source pressure units, and verifies numerical conservation/convergence.
It does not invoke the generated interactive plotting function.
Outputs are generic reference simulations, not patient-specific predictions.
