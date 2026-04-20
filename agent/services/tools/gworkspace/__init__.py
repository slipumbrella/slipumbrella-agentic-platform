"""Google Workspace agent tools — Docs, Sheets, Slides, Drive."""

from agent.services.tools.gworkspace.docs_tools import (
    gdocs_create_tool,
    gdocs_read_tool,
    gdocs_append_tool,
)
from agent.services.tools.gworkspace.sheets_tools import (
    gsheets_create_tool,
    gsheets_read_tool,
    gsheets_write_tool,
)
from agent.services.tools.gworkspace.slides_tools import (
    gslides_create_tool,
    gslides_read_tool,
    gslides_add_slide_tool,
)
from agent.services.tools.gworkspace.drive_tools import (
    gdrive_list_artifacts_tool,
)

__all__ = [
    "gdocs_create_tool",
    "gdocs_read_tool",
    "gdocs_append_tool",
    "gsheets_create_tool",
    "gsheets_read_tool",
    "gsheets_write_tool",
    "gslides_create_tool",
    "gslides_read_tool",
    "gslides_add_slide_tool",
    "gdrive_list_artifacts_tool",
]
