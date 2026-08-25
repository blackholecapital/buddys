import { AppBar, Toolbar, Typography } from "@mui/material";

export default function Topbar() {
  return (
    <AppBar
      position="static"
      color="transparent"
      elevation={0}
    >
      <Toolbar>
        <Typography variant="h5">
          Alley AI Concierge
        </Typography>
      </Toolbar>
    </AppBar>
  );
}
