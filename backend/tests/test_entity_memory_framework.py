"""
Test Suite for Entity Memory Framework

Tests configuration-driven entity extraction, reference detection,
and LangGraph integration.

Run:
    pytest backend/tests/test_entity_memory_framework.py -v
"""

import pytest
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from components.entity_memory_framework import (
    EntityMemoryFramework,
    ENTITY_CONFIG,
    extract_entities,
    detect_reference,
    build_fetch_plan,
    merge_entities,
)


class TestEntityExtraction:
    """Test entity extraction from tool outputs"""
    
    def test_extract_incidents_from_backlog(self):
        """Should extract incidents from fetch_backlog_overview output"""
        framework = EntityMemoryFramework()
        
        tool_outputs = {
            "fetch_backlog_overview": {
                "sample": [
                    {"number": "INC0000001", "short_description": "Issue 1"},
                    {"number": "INC0000002", "short_description": "Issue 2"},
                    {"number": "INC0000003", "short_description": "Issue 3"},
                ]
            }
        }
        
        result = framework.extract_entities_from_outputs(tool_outputs)
        
        assert "incidents" in result
        assert len(result["incidents"]) == 3
        assert "INC0000001" in result["incidents"]
        assert "INC0000002" in result["incidents"]
        assert "INC0000003" in result["incidents"]
    
    def test_extract_incidents_from_single_fetch(self):
        """Should extract single incident from fetch_servicenow_incident output"""
        framework = EntityMemoryFramework()
        
        tool_outputs = {
            "fetch_servicenow_incident": {
                "number": "INC0010001",
                "short_description": "Database connection failure",
                "state": "New"
            }
        }
        
        result = framework.extract_entities_from_outputs(tool_outputs)
        
        assert "incidents" in result
        assert result["incidents"] == ["INC0010001"]
    
    def test_extract_user_stories(self):
        """Should extract user stories from JIRA tool output"""
        framework = EntityMemoryFramework()
        
        tool_outputs = {
            "jira_fetch_user_story": {
                "issues": [
                    {"key": "PROJ-123", "summary": "Story 1"},
                    {"key": "PROJ-456", "summary": "Story 2"},
                ]
            }
        }
        
        result = framework.extract_entities_from_outputs(tool_outputs)
        
        assert "user_stories" in result
        assert len(result["user_stories"]) == 2
        assert "PROJ-123" in result["user_stories"]
    
    def test_extract_wiki_pages(self):
        """Should extract wiki pages from wiki_rag_tool output"""
        framework = EntityMemoryFramework()
        
        tool_outputs = {
            "wiki_rag_tool": {
                "chunks": [
                    {"page_id": "12345", "title": "Getting Started"},
                    {"page_id": "67890", "title": "Advanced Topics"},
                ]
            }
        }
        
        result = framework.extract_entities_from_outputs(tool_outputs)
        
        assert "wiki_pages" in result
        assert len(result["wiki_pages"]) == 2
    
    def test_extract_multiple_entity_types(self):
        """Should extract multiple entity types from mixed tool outputs"""
        framework = EntityMemoryFramework()
        
        tool_outputs = {
            "fetch_backlog_overview": {
                "sample": [
                    {"number": "INC0000001"},
                    {"number": "INC0000002"},
                ]
            },
            "jira_fetch_user_story": {
                "issues": [
                    {"key": "PROJ-123"},
                ]
            },
        }
        
        result = framework.extract_entities_from_outputs(tool_outputs)
        
        assert "incidents" in result
        assert "user_stories" in result
        assert len(result["incidents"]) == 2
        assert len(result["user_stories"]) == 1
    
    def test_deduplicate_entities(self):
        """Should deduplicate entities within same type"""
        framework = EntityMemoryFramework()
        
        tool_outputs = {
            "fetch_backlog_overview": {
                "sample": [
                    {"number": "INC0000001"},
                    {"number": "INC0000001"},  # Duplicate
                    {"number": "INC0000002"},
                ]
            }
        }
        
        result = framework.extract_entities_from_outputs(tool_outputs)
        
        assert len(result["incidents"]) == 2  # Deduped
    
    def test_limit_entities_per_type(self):
        """Should cap entities at 20 per type"""
        framework = EntityMemoryFramework()
        
        # Generate 30 incidents
        tool_outputs = {
            "fetch_backlog_overview": {
                "sample": [
                    {"number": f"INC{str(i).zfill(7)}"}
                    for i in range(30)
                ]
            }
        }
        
        result = framework.extract_entities_from_outputs(tool_outputs)
        
        assert len(result["incidents"]) == 20  # Capped


class TestReferenceDetection:
    """Test pronoun/reference detection"""
    
    def test_detect_those_incidents(self):
        """Should detect 'those incidents' reference"""
        framework = EntityMemoryFramework()
        
        question = "Can you list those incidents for me?"
        cached = {
            "incidents": ["INC0000001", "INC0000002", "INC0000003"]
        }
        
        result = framework.detect_entity_reference(question, cached)
        
        assert result is not None
        assert result["entity_type"] == "incidents"
        assert result["pattern"] == "those incidents"
        assert result["count"] == 3
        assert result["fetch_tool"] == "fetch_servicenow_incident"
        assert result["id_param"] == "incident_number"
    
    def test_detect_them_reference(self):
        """Should detect generic 'them' when incidents cached"""
        framework = EntityMemoryFramework()
        
        question = "Show me details for them"
        cached = {
            "incidents": ["INC0000001"]
        }
        
        result = framework.detect_entity_reference(question, cached)
        
        assert result is not None
        assert result["entity_type"] == "incidents"
    
    def test_detect_user_stories_reference(self):
        """Should detect user stories reference"""
        framework = EntityMemoryFramework()
        
        question = "What are the details of those stories?"
        cached = {
            "user_stories": ["PROJ-123", "PROJ-456"]
        }
        
        result = framework.detect_entity_reference(question, cached)
        
        assert result is not None
        assert result["entity_type"] == "user_stories"
        assert result["fetch_tool"] == "jira_fetch_user_story"
    
    def test_prioritize_specific_over_generic(self):
        """Should prioritize specific entity reference over generic pronoun"""
        framework = EntityMemoryFramework()
        
        question = "Show me those incidents"  # Specific: incidents
        cached = {
            "incidents": ["INC0000001"],
            "user_stories": ["PROJ-123"]  # Both types cached
        }
        
        result = framework.detect_entity_reference(question, cached)
        
        assert result["entity_type"] == "incidents"  # Should match incidents, not stories
    
    def test_no_reference_detected(self):
        """Should return None when no reference pattern matches"""
        framework = EntityMemoryFramework()
        
        question = "What is the weather today?"
        cached = {
            "incidents": ["INC0000001"]
        }
        
        result = framework.detect_entity_reference(question, cached)
        
        assert result is None
    
    def test_no_cached_entities(self):
        """Should return None when no entities cached"""
        framework = EntityMemoryFramework()
        
        question = "List those incidents"
        cached = {}
        
        result = framework.detect_entity_reference(question, cached)
        
        assert result is None


class TestFetchPlanBuilder:
    """Test execution plan generation"""
    
    def test_build_plan_for_incidents(self):
        """Should build fetch plan for incidents"""
        framework = EntityMemoryFramework()
        
        ref_info = {
            "entity_type": "incidents",
            "entities": ["INC0000001", "INC0000002", "INC0000003"],
            "fetch_tool": "fetch_servicenow_incident",
            "id_param": "incident_number"
        }
        
        plan = framework.build_fetch_plan(ref_info, limit=5)
        
        assert len(plan) == 3
        assert plan[0]["function_name"] == "fetch_servicenow_incident"
        assert plan[0]["arguments"]["incident_number"] == "INC0000001"
        assert plan[1]["arguments"]["incident_number"] == "INC0000002"
    
    def test_limit_plan_size(self):
        """Should limit plan to specified limit"""
        framework = EntityMemoryFramework()
        
        ref_info = {
            "entity_type": "incidents",
            "entities": ["INC1", "INC2", "INC3", "INC4", "INC5", "INC6", "INC7"],
            "fetch_tool": "fetch_servicenow_incident",
            "id_param": "incident_number"
        }
        
        plan = framework.build_fetch_plan(ref_info, limit=3)
        
        assert len(plan) == 3  # Limited to 3
        assert plan[0]["arguments"]["incident_number"] == "INC1"
        assert plan[2]["arguments"]["incident_number"] == "INC3"
    
    def test_build_plan_for_user_stories(self):
        """Should build plan for user stories with correct param name"""
        framework = EntityMemoryFramework()
        
        ref_info = {
            "entity_type": "user_stories",
            "entities": ["PROJ-123"],
            "fetch_tool": "jira_fetch_user_story",
            "id_param": "story_key"
        }
        
        plan = framework.build_fetch_plan(ref_info, limit=5)
        
        assert len(plan) == 1
        assert plan[0]["function_name"] == "jira_fetch_user_story"
        assert plan[0]["arguments"]["story_key"] == "PROJ-123"


class TestEntityMerging:
    """Test entity cache merging"""
    
    def test_merge_new_entities(self):
        """Should merge new entities with existing"""
        framework = EntityMemoryFramework()
        
        existing = {
            "incidents": ["INC0000001", "INC0000002"]
        }
        
        new = {
            "incidents": ["INC0000003", "INC0000004"]
        }
        
        merged = framework.merge_cached_entities(existing, new, max_per_type=20)
        
        assert len(merged["incidents"]) == 4
        assert "INC0000001" in merged["incidents"]
        assert "INC0000003" in merged["incidents"]
    
    def test_merge_prioritizes_new_entities(self):
        """Should place new entities first (more recent)"""
        framework = EntityMemoryFramework()
        
        existing = {
            "incidents": ["INC_OLD_1", "INC_OLD_2"]
        }
        
        new = {
            "incidents": ["INC_NEW_1", "INC_NEW_2"]
        }
        
        merged = framework.merge_cached_entities(existing, new, max_per_type=20)
        
        # New entities should come first
        assert merged["incidents"][0] == "INC_NEW_1"
        assert merged["incidents"][1] == "INC_NEW_2"
        assert merged["incidents"][2] == "INC_OLD_1"
    
    def test_merge_deduplicates(self):
        """Should deduplicate when merging"""
        framework = EntityMemoryFramework()
        
        existing = {
            "incidents": ["INC0000001", "INC0000002"]
        }
        
        new = {
            "incidents": ["INC0000002", "INC0000003"]  # INC0000002 is duplicate
        }
        
        merged = framework.merge_cached_entities(existing, new, max_per_type=20)
        
        assert len(merged["incidents"]) == 3  # Deduped
        assert merged["incidents"].count("INC0000002") == 1
    
    def test_merge_respects_limit(self):
        """Should enforce max_per_type limit"""
        framework = EntityMemoryFramework()
        
        existing = {
            "incidents": [f"INC{i}" for i in range(10)]
        }
        
        new = {
            "incidents": [f"INC_NEW_{i}" for i in range(15)]
        }
        
        merged = framework.merge_cached_entities(existing, new, max_per_type=12)
        
        assert len(merged["incidents"]) == 12  # Capped at 12
        # Should prioritize new entities
        assert "INC_NEW_0" in merged["incidents"]
    
    def test_merge_different_entity_types(self):
        """Should merge different entity types independently"""
        framework = EntityMemoryFramework()
        
        existing = {
            "incidents": ["INC0000001"]
        }
        
        new = {
            "user_stories": ["PROJ-123"]
        }
        
        merged = framework.merge_cached_entities(existing, new, max_per_type=20)
        
        assert "incidents" in merged
        assert "user_stories" in merged
        assert len(merged["incidents"]) == 1
        assert len(merged["user_stories"]) == 1


class TestConvenienceFunctions:
    """Test module-level convenience functions"""
    
    def test_extract_entities_function(self):
        """Should work via module-level function"""
        tool_outputs = {
            "fetch_backlog_overview": {
                "sample": [{"number": "INC0000001"}]
            }
        }
        
        result = extract_entities(tool_outputs)
        
        assert "incidents" in result
        assert result["incidents"] == ["INC0000001"]
    
    def test_detect_reference_function(self):
        """Should work via module-level function"""
        question = "Show me those incidents"
        cached = {"incidents": ["INC0000001"]}
        
        result = detect_reference(question, cached)
        
        assert result is not None
        assert result["entity_type"] == "incidents"
    
    def test_build_fetch_plan_function(self):
        """Should work via module-level function"""
        ref_info = {
            "entity_type": "incidents",
            "entities": ["INC0000001"],
            "fetch_tool": "fetch_servicenow_incident",
            "id_param": "incident_number"
        }
        
        plan = build_fetch_plan(ref_info, limit=5)
        
        assert len(plan) == 1
        assert plan[0]["function_name"] == "fetch_servicenow_incident"
    
    def test_merge_entities_function(self):
        """Should work via module-level function"""
        existing = {"incidents": ["INC1"]}
        new = {"incidents": ["INC2"]}
        
        merged = merge_entities(existing, new, max_per_type=20)
        
        assert len(merged["incidents"]) == 2


class TestEntityConfiguration:
    """Test configuration completeness"""
    
    def test_all_entity_types_have_extractors(self):
        """Each entity type should have at least one extractor"""
        for entity_type, config in ENTITY_CONFIG.items():
            assert "extractors" in config, f"{entity_type} missing extractors"
            assert len(config["extractors"]) > 0, f"{entity_type} has no extractors"
    
    def test_all_entity_types_have_patterns(self):
        """Each entity type should have reference patterns"""
        for entity_type, config in ENTITY_CONFIG.items():
            assert "patterns" in config, f"{entity_type} missing patterns"
            assert len(config["patterns"]) > 0, f"{entity_type} has no patterns"
    
    def test_all_entity_types_have_fetch_tool(self):
        """Each entity type should have a fetch tool"""
        for entity_type, config in ENTITY_CONFIG.items():
            assert "fetch_tool" in config, f"{entity_type} missing fetch_tool"
            assert config["fetch_tool"], f"{entity_type} has empty fetch_tool"
    
    def test_all_entity_types_have_id_param(self):
        """Each entity type should have ID parameter name"""
        for entity_type, config in ENTITY_CONFIG.items():
            assert "id_param" in config, f"{entity_type} missing id_param"
            assert config["id_param"], f"{entity_type} has empty id_param"
    
    def test_all_entity_types_have_source_tools(self):
        """Each entity type should list source tools"""
        for entity_type, config in ENTITY_CONFIG.items():
            assert "source_tools" in config, f"{entity_type} missing source_tools"
            assert len(config["source_tools"]) > 0, f"{entity_type} has no source_tools"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
