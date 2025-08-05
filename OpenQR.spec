# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['openqr/app.py'],
    pathex=[],
    binaries=[],
    datas=[('assets/openqr_icon.png', 'assets')],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='OpenQR',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=['assets/openqr_icon.png'],
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='OpenQR',
)
app = BUNDLE(
    coll,
    name='OpenQR.app',
    icon='assets/openqr_icon.png',
    bundle_identifier=None,
)
