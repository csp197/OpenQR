# OpenQR.spec
# -*- mode: python ; coding: utf-8 -*-

block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=[('assets/openqr_icon.png', 'assets')],
    hiddenimports=[],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

app = BUNDLE(
    exe=EXE(
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
        icon='assets/openqr_icon.icns',  # your macOS icon
    ),
    name='OpenQR.app',
    icon='assets/openqr_icon.icns',
    bundle_identifier='com.csp.openqr',
    info_plist=open('assets/Info.plist.in').read(),
)

coll = COLLECT(
    app,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='OpenQR'
)
