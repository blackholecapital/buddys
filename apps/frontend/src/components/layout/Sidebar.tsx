import { Drawer, Toolbar, List, ListItemButton, ListItemText, Typography, Box } from "@mui/material";
import { Link } from "react-router-dom";

const width = 240;

const links = [
  ["Dashboard", "/dashboard"],
  ["Leads", "/contacts"],
  ["Conversations", "/conversations"],
  ["Communications", "/inbox"],
  ["Campaigns", "/campaigns"],
  ["System Health", "/system"],
  ["Settings", "/settings"],
  ["Buddy's Demo", "/buddys/#contact-form"],
];

export default function Sidebar() {
  return (
    <Drawer
      variant="permanent"
      sx={{
        width,
        "& .MuiDrawer-paper": {
          width,
          boxSizing: "border-box",
        },
      }}
    >
      <Toolbar>
        <Box>
          <Typography variant="h6">
            Alley AI
          </Typography>
          <Typography variant="body2">
            Concierge
          </Typography>
        </Box>
      </Toolbar>

      <List>
        {links.map(([label, path]) => (
          <ListItemButton
            component={Link}
            to={path}
            key={label}
          >
            <ListItemText primary={label} />
          </ListItemButton>
        ))}
      </List>
    </Drawer>
  );
}
