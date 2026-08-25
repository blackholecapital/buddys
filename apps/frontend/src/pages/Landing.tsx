import { Box, Button, Paper, Typography } from "@mui/material";
import { Link } from "react-router-dom";

export default function Landing() {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        p: 3,
      }}
    >
      <Paper sx={{ maxWidth: 700, width: "100%", p: 5 }}>
        <Typography variant="h3" gutterBottom>
          Alley AI Concierge
        </Typography>

        <Typography variant="h6" color="text.secondary" gutterBottom>
          AI-powered communications for modern businesses.
        </Typography>

        <Typography sx={{ mt: 3, mb: 4 }}>
          Capture leads, automate conversations, and manage customer
          communications from one intelligent dashboard.
        </Typography>

        <Button
          component={Link}
          to="/dashboard"
          variant="contained"
          size="large"
        >
          Open Dashboard
        </Button>

        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 6 }}
        >
          Powered by BlackHole
        </Typography>
      </Paper>
    </Box>
  );
}
