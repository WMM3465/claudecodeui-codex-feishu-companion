[Version]
Class=IEXPRESS
SEDVersion=3

[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=1
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=C:\Users\Administrator\Desktop\codex-workspace\workspace-launcher\publish-lite\FeishuCodexLauncher.exe
FriendlyName=Feishu Codex Workspace Launcher
AppLaunched=powershell.exe -NoProfile -ExecutionPolicy Bypass -File launch-workspace.ps1
PostInstallCmd=<None>
AdminQuietInstCmd=powershell.exe -NoProfile -ExecutionPolicy Bypass -File launch-workspace.ps1
UserQuietInstCmd=powershell.exe -NoProfile -ExecutionPolicy Bypass -File launch-workspace.ps1
SourceFiles=SourceFiles

[SourceFiles]
SourceFiles0=C:\Users\Administrator\Desktop\codex-workspace\workspace-launcher\

[SourceFiles0]
%FILE0%=
%FILE1%=

[Strings]
FILE0=launch-workspace.ps1
FILE1=launcher-config.json
