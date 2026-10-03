!include "MUI2.nsh"

!ifndef BUILD_UNINSTALLER

Var InstallerServerUrl
Var InstallerAppName
Var InstallerPreviousAppName
Var InstallerServerUrlField
Var InstallerAppNameField
Var InstallerStartMenuLink
Var InstallerDesktopLink
Var InstallerOriginalAppData

!macro customInit
  ReadRegStr $InstallerPreviousAppName SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" ShortcutName
  StrCpy $InstallerAppName $InstallerPreviousAppName
  ${If} $InstallerAppName == ""
    StrCpy $InstallerAppName "${SHORTCUT_NAME}"
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom BusinessSetupPageCreate BusinessSetupPageLeave
!macroend

Function BusinessSetupPageCreate
  ${If} ${Silent}
    Abort
  ${EndIf}

  StrCpy $InstallerServerUrl "https://app.restaurant-x.one"
  StrCpy $InstallerOriginalAppData $APPDATA
  SetShellVarContext current
  ${If} ${FileExists} "$APPDATA\RestaurantX POS\pending-installer-setup.txt"
    ClearErrors
    FileOpen $0 "$APPDATA\RestaurantX POS\pending-installer-setup.txt" r
    ${IfNot} ${Errors}
      FileRead $0 $InstallerServerUrl
      FileClose $0
      StrCpy $1 $InstallerServerUrl 1 -1
      ${If} $1 == "$\n"
        StrCpy $InstallerServerUrl $InstallerServerUrl -1
      ${EndIf}
      StrCpy $1 $InstallerServerUrl 1 -1
      ${If} $1 == "$\r"
        StrCpy $InstallerServerUrl $InstallerServerUrl -1
      ${EndIf}
    ${EndIf}
  ${EndIf}
  ${If} $APPDATA != $InstallerOriginalAppData
    SetShellVarContext all
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "Set up Offline POS" "Choose its Windows name and connect this business terminal."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 4u 100% 12u "Application name"
  Pop $0
  ${NSD_CreateText} 0 19u 100% 13u "$InstallerAppName"
  Pop $InstallerAppNameField
  ${NSD_Edit_SetTextLimit} $InstallerAppNameField 80

  ${NSD_CreateLabel} 0 43u 100% 12u "Server URL"
  Pop $0
  ${NSD_CreateText} 0 58u 100% 13u "$InstallerServerUrl"
  Pop $InstallerServerUrlField

  ${NSD_CreateLabel} 0 82u 100% 24u "This name appears in Windows Search. Sign in when Offline POS starts to connect this terminal."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function BusinessSetupPageLeave
  ${NSD_GetText} $InstallerAppNameField $InstallerAppName
  ${NSD_GetText} $InstallerServerUrlField $InstallerServerUrl

  ${If} $InstallerAppName == ""
    MessageBox MB_ICONEXCLAMATION "Enter the application name."
    Abort
  ${EndIf}
  Call ValidateApplicationName
  Pop $0
  ${If} $0 != "1"
    MessageBox MB_ICONEXCLAMATION 'Application name cannot start or end with a space or dot, or contain \ / : * ? " < > |.'
    Abort
  ${EndIf}
  ${If} $InstallerServerUrl == ""
    MessageBox MB_ICONEXCLAMATION "Enter the server URL."
    Abort
  ${EndIf}

  StrCpy $InstallerOriginalAppData $APPDATA
  SetShellVarContext current
  CreateDirectory "$APPDATA\RestaurantX POS"
  ClearErrors
  FileOpen $0 "$APPDATA\RestaurantX POS\pending-installer-setup.txt" w
  ${If} ${Errors}
    ${If} $APPDATA != $InstallerOriginalAppData
      SetShellVarContext all
    ${EndIf}
    MessageBox MB_ICONEXCLAMATION "Unable to save the server URL. Check your Windows account permissions and try again."
    Abort
  ${EndIf}
  FileWrite $0 "$InstallerServerUrl$\r$\n"
  FileClose $0
  ${If} $APPDATA != $InstallerOriginalAppData
    SetShellVarContext all
  ${EndIf}
FunctionEnd

Function ValidateApplicationName
  StrLen $1 $InstallerAppName
  StrCpy $0 0
  StrCpy $2 $InstallerAppName 1 0
  StrCmp $2 " " ApplicationNameInvalid
  StrCmp $2 "." ApplicationNameInvalid

ApplicationNameCharacterLoop:
  StrCmp $0 $1 ApplicationNameLastCharacter
  StrCpy $2 $InstallerAppName 1 $0
  StrCmp $2 "\" ApplicationNameInvalid
  StrCmp $2 "/" ApplicationNameInvalid
  StrCmp $2 ":" ApplicationNameInvalid
  StrCmp $2 "*" ApplicationNameInvalid
  StrCmp $2 "?" ApplicationNameInvalid
  StrCmp $2 "$\"" ApplicationNameInvalid
  StrCmp $2 "<" ApplicationNameInvalid
  StrCmp $2 ">" ApplicationNameInvalid
  StrCmp $2 "|" ApplicationNameInvalid
  IntOp $0 $0 + 1
  Goto ApplicationNameCharacterLoop

ApplicationNameLastCharacter:
  IntOp $1 $1 - 1
  StrCpy $2 $InstallerAppName 1 $1
  StrCmp $2 " " ApplicationNameInvalid
  StrCmp $2 "." ApplicationNameInvalid
  Push "1"
  Return

ApplicationNameInvalid:
  Push "0"
FunctionEnd

!macro customInstall
  ${If} $InstallerAppName != ""
  ${AndIf} $InstallerAppName != "${SHORTCUT_NAME}"
    StrCpy $InstallerStartMenuLink "$SMPROGRAMS\$InstallerAppName.lnk"
    StrCpy $InstallerDesktopLink "$DESKTOP\$InstallerAppName.lnk"

    ${If} ${FileExists} "$newStartMenuLink"
      Rename "$newStartMenuLink" "$InstallerStartMenuLink"
      ${IfNot} ${Errors}
        StrCpy $launchLink "$InstallerStartMenuLink"
      ${Else}
        StrCpy $InstallerAppName "${SHORTCUT_NAME}"
      ${EndIf}
    ${EndIf}

    ${If} $InstallerAppName != "${SHORTCUT_NAME}"
    ${AndIf} ${FileExists} "$newDesktopLink"
      Rename "$newDesktopLink" "$InstallerDesktopLink"
    ${EndIf}
  ${EndIf}

  ${If} $InstallerPreviousAppName != ""
  ${AndIf} $InstallerPreviousAppName != $InstallerAppName
    Delete "$SMPROGRAMS\$InstallerPreviousAppName.lnk"
    Delete "$DESKTOP\$InstallerPreviousAppName.lnk"
  ${EndIf}

  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" ShortcutName "$InstallerAppName"
!macroend

!endif
