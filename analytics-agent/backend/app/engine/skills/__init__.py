"""Skill registry."""
from __future__ import annotations

from typing import Dict, List

from .base import Applicability, Skill
from .customer import CustomerSkill
from .forecasting import ForecastingSkill
from .inventory import InventorySkill
from .product import ProductSkill
from .sales import SalesSkill
from .statistics import StatisticsSkill

ALL_SKILLS: List[Skill] = [
    SalesSkill(),
    CustomerSkill(),
    ProductSkill(),
    InventorySkill(),
    StatisticsSkill(),
    ForecastingSkill(),
]

SKILLS_BY_KEY: Dict[str, Skill] = {s.key: s for s in ALL_SKILLS}

__all__ = ["ALL_SKILLS", "SKILLS_BY_KEY", "Skill", "Applicability"]
