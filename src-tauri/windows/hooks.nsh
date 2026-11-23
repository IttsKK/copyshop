; The Windows installer's own steps (tauri.windows.conf.json installerHooks).
;
; DirectML.dll beside the app: precise selection's ONNX Runtime (src/ml.rs) was
; built against this DirectML, newer than the one Windows has. The build puts it
; in target/release next to the app (ort's copy-dylibs), where it is taken from.

!macro NSIS_HOOK_POSTINSTALL
  SetOutPath "$INSTDIR"
  File "${__FILEDIR__}\..\target\release\DirectML.dll"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\DirectML.dll"
!macroend
