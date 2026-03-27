"""
Comprehensive test suite for Swagger-based cost-optimized mapping system.

Tests all components:
- Swagger parser (parsers.py)
- Embedding cache manager (embedding_cache.py)
- Hybrid mapping engine (hybrid_engine.py)
- API relevance ranking (swagger_relevance.py)
- Progressive mapper (progressive_mapper.py)
- Integration (swagger_integration.py)
- REST API endpoints (mapping_api.py)
"""
import json
import os
import tempfile
import shutil
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
import pytest

# Add parent directory to path for imports
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from components.mapping_agents.parsers import (
    parse_swagger,
    parse_word_document,
    SwaggerSummary,
    WordSummary
)
from components.mapping_agents.embedding_cache import (
    EmbeddingCacheManager,
    get_global_cache
)
from components.mapping_agents.hybrid_engine import HybridMappingEngine
from components.mapping_agents.swagger_relevance import SwaggerRelevanceEngine
from components.mapping_agents.progressive_mapper import ProgressiveMappingOrchestrator
from components.mapping_agents.state import MappingState


# Test data paths
TEST_DATA_DIR = Path(__file__).parent / "test_excels" / "enriched"
SWAGGER_FILE = TEST_DATA_DIR / "group_accident_insurance_api.yaml"
WORD_FILE = TEST_DATA_DIR / "Group Accident PAS Proposal_Generalized Template.docx"


class TestSwaggerParser:
    """Test Swagger/OpenAPI parsing functionality."""
    
    def test_parse_valid_swagger_yaml(self):
        """Test parsing a valid Swagger YAML file."""
        if not SWAGGER_FILE.exists():
            pytest.skip(f"Swagger file not found: {SWAGGER_FILE}")
        
        summary = parse_swagger(str(SWAGGER_FILE))
        
        assert isinstance(summary, SwaggerSummary)
        assert summary.api_title == "Group Accident Insurance API"
        assert summary.api_version == "2.1.0"
        assert len(summary.operations) > 0
        
        # Verify specific operations
        operation_ids = [op.operation_id for op in summary.operations]
        assert "createProposal" in operation_ids
        assert "addCoverageOption" in operation_ids
        assert "calculatePremium" in operation_ids
        assert "createPolicy" in operation_ids
        assert "submitClaim" in operation_ids
    
    def test_parse_swagger_extracts_attributes(self):
        """Test that parser extracts input/output attributes correctly."""
        if not SWAGGER_FILE.exists():
            pytest.skip(f"Swagger file not found: {SWAGGER_FILE}")
        
        summary = parse_swagger(str(SWAGGER_FILE))
        
        # Find createProposal operation
        create_proposal = next(
            (op for op in summary.operations if op.operation_id == "createProposal"),
            None
        )
        assert create_proposal is not None
        
        # Check input attributes
        input_names = [attr.name for attr in create_proposal.input_attributes]
        assert "employer_name" in input_names
        assert "broker_name" in input_names
        assert "eligible_lives" in input_names
        assert "sic_code" in input_names
        assert "effective_date" in input_names
        
        # Check output attributes
        output_names = [attr.name for attr in create_proposal.output_attributes]
        assert "proposal_id" in output_names
        assert "status" in output_names
    
    def test_parse_swagger_flattens_nested_schemas(self):
        """Test that nested JSON schemas are flattened to dot notation."""
        if not SWAGGER_FILE.exists():
            pytest.skip(f"Swagger file not found: {SWAGGER_FILE}")
        
        summary = parse_swagger(str(SWAGGER_FILE))
        
        # Find addBeneficiary operation with nested address
        add_beneficiary = next(
            (op for op in summary.operations if op.operation_id == "addBeneficiary"),
            None
        )
        assert add_beneficiary is not None
        
        # Check flattened nested attributes
        input_paths = [attr.path for attr in add_beneficiary.input_attributes]
        assert any("address.street" in path for path in input_paths)
        assert any("address.city" in path for path in input_paths)
        assert any("address.state" in path for path in input_paths)
    
    def test_parse_invalid_swagger_raises_error(self):
        """Test that invalid Swagger file raises appropriate error."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            f.write("invalid: yaml: content: [")
            invalid_file = f.name
        
        try:
            with pytest.raises(Exception):  # Should raise parsing error
                parse_swagger(invalid_file)
        finally:
            os.unlink(invalid_file)
    
    def test_parse_nonexistent_file_raises_error(self):
        """Test that nonexistent file raises error."""
        from components.mapping_agents.exceptions import MappingDataError
        
        with pytest.raises(MappingDataError):
            parse_swagger("/nonexistent/file.yaml")


class TestEmbeddingCache:
    """Test unified embedding cache manager."""
    
    def setup_method(self):
        """Create temporary cache for testing."""
        self.temp_dir = tempfile.mkdtemp()
        self.cache_file = os.path.join(self.temp_dir, "test_cache.json")
    
    def teardown_method(self):
        """Clean up temporary cache."""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_cache_initialization(self):
        """Test cache manager initialization."""
        cache = EmbeddingCacheManager(cache_path=self.cache_file)
        
        assert cache.cache == {}
        assert cache.hit_count == 0
        assert cache.miss_count == 0
    
    def test_sha256_text_hashing(self):
        """Test consistent SHA256 hashing of text."""
        cache = EmbeddingCacheManager(cache_path=self.cache_file)
        
        text1 = "employer_name"
        text2 = "employer_name"
        text3 = "broker_name"
        
        hash1 = cache._hash_text(text1)
        hash2 = cache._hash_text(text2)
        hash3 = cache._hash_text(text3)
        
        assert hash1 == hash2  # Same text = same hash
        assert hash1 != hash3  # Different text = different hash
        assert len(hash1) == 64  # SHA256 produces 64-char hex
    
    def test_cache_hit_and_miss(self):
        """Test cache hit and miss tracking."""
        cache = EmbeddingCacheManager(cache_path=self.cache_file)
        
        # Mock embedding generator
        mock_gen = Mock(return_value=[0.1, 0.2, 0.3])
        
        # First call - cache miss
        result1 = cache.get_or_generate("test_text", mock_gen)
        assert cache.miss_count == 1
        assert cache.hit_count == 0
        assert result1 == [0.1, 0.2, 0.3]
        
        # Second call - cache hit
        result2 = cache.get_or_generate("test_text", mock_gen)
        assert cache.miss_count == 1
        assert cache.hit_count == 1
        assert result2 == [0.1, 0.2, 0.3]
        
        # Generator should only be called once
        assert mock_gen.call_count == 1
    
    def test_batch_get_or_generate(self):
        """Test batch embedding generation with cache."""
        cache = EmbeddingCacheManager(cache_path=self.cache_file)
        
        # Pre-populate cache with one embedding
        cache.cache[cache._hash_text("cached_text")] = [0.5, 0.6, 0.7]
        cache.force_save()
        
        # Mock batch generator
        mock_gen = Mock(return_value=[[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]])
        
        texts = ["cached_text", "new_text_1", "new_text_2"]
        results = cache.batch_get_or_generate(texts, mock_gen)
        
        assert len(results) == 3
        assert results[0] == [0.5, 0.6, 0.7]  # From cache
        assert results[1] == [0.1, 0.2, 0.3]  # Generated
        assert results[2] == [0.4, 0.5, 0.6]  # Generated
        
        # Generator called only for 2 new texts
        mock_gen.assert_called_once_with(["new_text_1", "new_text_2"])
    
    def test_cache_persistence(self):
        """Test cache persists to disk."""
        cache1 = EmbeddingCacheManager(cache_path=self.cache_file)
        
        mock_gen = Mock(return_value=[0.1, 0.2, 0.3])
        cache1.get_or_generate("persist_test", mock_gen)
        cache1.force_save()
        
        # Create new cache instance from same file
        cache2 = EmbeddingCacheManager(cache_path=self.cache_file)
        
        # Should load from disk
        result = cache2.get_or_generate("persist_test", Mock())
        assert result == [0.1, 0.2, 0.3]
        assert cache2.hit_count == 1  # Cache hit from persisted data
    
    def test_get_stats(self):
        """Test cache statistics reporting."""
        cache = EmbeddingCacheManager(cache_path=self.cache_file)
        
        mock_gen = Mock(side_effect=lambda x: [0.1, 0.2, 0.3])
        
        cache.get_or_generate("text1", mock_gen)
        cache.get_or_generate("text1", mock_gen)
        cache.get_or_generate("text2", mock_gen)
        
        stats = cache.get_stats()
        
        assert stats['hit_count'] == 1
        assert stats['miss_count'] == 2
        assert stats['total_cached'] == 2
        assert stats['hit_rate_percent'] == 33  # 1 hit out of 3 requests


class TestHybridMappingEngine:
    """Test three-tier hybrid mapping engine."""
    
    def test_tier1_exact_match(self):
        """Test Tier 1: Exact string matching."""
        engine = HybridMappingEngine(confidence_threshold=0.7)
        
        targets = [
            {'name': 'employer_name', 'description': ''},
            {'name': 'broker_name', 'description': ''}
        ]
        
        candidates = [
            {'name': 'employer_name', 'path': 'employer_name', 'description': 'Legal name'},
            {'name': 'broker', 'path': 'broker_name', 'description': 'Broker name'},
            {'name': 'other_field', 'path': 'other', 'description': ''}
        ]
        
        # Mock embedding generator (shouldn't be called for exact matches)
        mock_gen = Mock()
        
        mappings = engine.map_targets_hybrid(targets, candidates, mock_gen, None)
        
        # Should find exact match for employer_name
        assert len(mappings) > 0
        employer_mapping = next((m for m in mappings if m['target_name'] == 'employer_name'), None)
        assert employer_mapping is not None
        assert employer_mapping['source_name'] == 'employer_name'
        assert employer_mapping['confidence'] >= 0.9
        assert employer_mapping['method'] == 'exact_match'
        
        # No embeddings should be generated for exact matches
        assert mock_gen.call_count == 0
    
    def test_tier1_fuzzy_match(self):
        """Test Tier 1: Fuzzy string matching."""
        engine = HybridMappingEngine(confidence_threshold=0.7)
        
        targets = [
            {'name': 'PolicyNumber', 'description': ''},
            {'name': 'EffectiveDate', 'description': ''}
        ]
        
        candidates = [
            {'name': 'policy_number', 'path': 'policy_number', 'description': ''},
            {'name': 'effective_date', 'path': 'effective_date', 'description': ''}
        ]
        
        mock_gen = Mock()
        
        mappings = engine.map_targets_hybrid(targets, candidates, mock_gen, None)
        
        # Should find fuzzy matches
        assert len(mappings) == 2
        
        policy_mapping = next((m for m in mappings if 'PolicyNumber' in m['target_name']), None)
        assert policy_mapping is not None
        assert 'policy_number' in policy_mapping['source_name']
        assert policy_mapping['method'] == 'fuzzy_match'
    
    def test_tier2_embedding_similarity(self):
        """Test Tier 2: Embedding-based similarity matching."""
        engine = HybridMappingEngine(confidence_threshold=0.7)
        
        targets = [
            {'name': 'premium_amount', 'description': 'Monthly premium cost'}
        ]
        
        candidates = [
            {'name': 'total_monthly_premium', 'path': 'premium', 'description': 'Total premium per month'}
        ]
        
        # Mock embedding generator
        def mock_embedding_gen(texts):
            # Return similar embeddings for premium-related terms
            return [[0.8, 0.1, 0.1] for _ in texts]
        
        # Mock cosine similarity calculation
        with patch('components.mapping_agents.hybrid_engine.cosine_similarity', 
                   return_value=[[0.85]]):
            
            mock_gen = Mock(side_effect=mock_embedding_gen)
            
            mappings = engine.map_targets_hybrid(targets, candidates, mock_gen, None)
            
            assert len(mappings) > 0
            mapping = mappings[0]
            assert mapping['target_name'] == 'premium_amount'
            assert mapping['method'] == 'embedding_similarity'
            assert mapping['confidence'] >= 0.7
    
    def test_tier3_llm_synthesis(self):
        """Test Tier 3: LLM-based synthesis."""
        engine = HybridMappingEngine(confidence_threshold=0.7)
        
        targets = [
            {'name': 'complex_calculated_field', 'description': 'Complex business logic'}
        ]
        
        candidates = [
            {'name': 'unrelated_field', 'path': 'unrelated', 'description': 'Not similar'}
        ]
        
        # Mock embedding generator (low similarity)
        def mock_embedding_gen(texts):
            return [[0.1, 0.9, 0.0], [0.9, 0.1, 0.0]]
        
        # Mock LLM synthesizer
        mock_llm = Mock(return_value={
            'target_name': 'complex_calculated_field',
            'source_name': 'synthesized_mapping',
            'source_path': 'api.calculated',
            'confidence': 0.75,
            'method': 'llm_synthesis'
        })
        
        with patch('components.mapping_agents.hybrid_engine.cosine_similarity',
                   return_value=[[0.1]]):  # Low similarity
            
            mock_gen = Mock(side_effect=mock_embedding_gen)
            
            mappings = engine.map_targets_hybrid(targets, candidates, mock_gen, mock_llm)
            
            assert len(mappings) > 0
            mapping = mappings[0]
            assert mapping['method'] == 'llm_synthesis'
            assert mock_llm.called
    
    def test_get_stats(self):
        """Test mapping statistics tracking."""
        engine = HybridMappingEngine(confidence_threshold=0.7)
        
        targets = [
            {'name': 'exact_match', 'description': ''},
            {'name': 'FuzzyMatch', 'description': ''},
            {'name': 'embedding_match', 'description': 'Similar text'}
        ]
        
        candidates = [
            {'name': 'exact_match', 'path': 'exact', 'description': ''},
            {'name': 'fuzzy_match', 'path': 'fuzzy', 'description': ''},
            {'name': 'similar_embedding', 'path': 'embed', 'description': 'Similar text'}
        ]
        
        def mock_embedding_gen(texts):
            return [[0.8, 0.2] for _ in texts]
        
        with patch('components.mapping_agents.hybrid_engine.cosine_similarity',
                   return_value=[[0.85]]):
            
            mock_gen = Mock(side_effect=mock_embedding_gen)
            engine.map_targets_hybrid(targets, candidates, mock_gen, None)
            
            stats = engine.get_stats()
            
            assert stats['tier1_total'] >= 2  # exact + fuzzy
            assert stats['total_mapped'] >= 2
            assert stats['cost_savings_percent'] > 0


class TestSwaggerRelevanceEngine:
    """Test semantic API relevance ranking."""
    
    def test_rank_apis_by_relevance(self):
        """Test API ranking based on semantic similarity."""
        # Create mock summaries
        swagger_summary = Mock(spec=SwaggerSummary)
        swagger_summary.operations = [
            Mock(
                operation_id="createProposal",
                endpoint="/proposals",
                method="POST",
                summary="Create insurance proposal",
                input_attributes=[],
                output_attributes=[]
            ),
            Mock(
                operation_id="unrelatedOperation",
                endpoint="/unrelated",
                method="GET",
                summary="Unrelated functionality",
                input_attributes=[],
                output_attributes=[]
            )
        ]
        
        word_summary = Mock(spec=WordSummary)
        word_summary.fields = [
            Mock(label="Employer Name", placeholder="[Employer name]"),
            Mock(label="Broker", placeholder="[broker]"),
            Mock(label="Effective Date", placeholder="[MM/DD/YYYY]")
        ]
        
        # Mock embedding generator
        def mock_embedding_gen(texts):
            # Simulate relevant vs irrelevant embeddings
            if "proposal" in str(texts).lower():
                return [[0.9, 0.1, 0.0]]
            else:
                return [[0.1, 0.0, 0.9]]
        
        mock_gen = Mock(side_effect=mock_embedding_gen)
        
        engine = SwaggerRelevanceEngine(swagger_summary, word_summary, mock_gen)
        
        ranked = engine.rank_apis_by_relevance(top_k=2, confidence_threshold=0.0)
        
        assert len(ranked) > 0
        # createProposal should rank higher than unrelatedOperation
        assert ranked[0]['operation'].operation_id == "createProposal"
    
    def test_rank_apis_filters_by_confidence(self):
        """Test that low-relevance APIs are filtered out."""
        swagger_summary = Mock(spec=SwaggerSummary)
        swagger_summary.operations = [
            Mock(
                operation_id="relevantOp",
                endpoint="/relevant",
                method="POST",
                summary="Very relevant operation",
                input_attributes=[],
                output_attributes=[]
            ),
            Mock(
                operation_id="irrelevantOp",
                endpoint="/irrelevant",
                method="GET",
                summary="Completely unrelated",
                input_attributes=[],
                output_attributes=[]
            )
        ]
        
        word_summary = Mock(spec=WordSummary)
        word_summary.fields = [Mock(label="Relevant field", placeholder="[field]")]
        
        # Mock embedding with high and low similarity
        with patch('components.mapping_agents.swagger_relevance.cosine_similarity',
                   side_effect=[[[0.9]], [[0.1]]]):  # High then low
            
            mock_gen = Mock(return_value=[[0.5, 0.5]])
            
            engine = SwaggerRelevanceEngine(swagger_summary, word_summary, mock_gen)
            
            # Filter with high threshold
            ranked = engine.rank_apis_by_relevance(top_k=10, confidence_threshold=0.5)
            
            # Should only include relevant operation
            assert len(ranked) == 1
            assert ranked[0]['operation'].operation_id == "relevantOp"


class TestProgressiveMappingOrchestrator:
    """Test checkpoint-based progressive mapping."""
    
    def setup_method(self):
        """Create temporary checkpoint directory."""
        self.temp_dir = tempfile.mkdtemp()
        self.checkpoint_dir = os.path.join(self.temp_dir, "checkpoints")
        os.makedirs(self.checkpoint_dir, exist_ok=True)
    
    def teardown_method(self):
        """Clean up temporary directory."""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_orchestrator_initialization(self):
        """Test orchestrator initialization with session."""
        state = MappingState()
        state.word_summary = Mock(fields=[Mock(label="field1"), Mock(label="field2")])
        
        orchestrator = ProgressiveMappingOrchestrator(
            session_id="test-session",
            state=state,
            checkpoint_dir=self.checkpoint_dir
        )
        
        assert orchestrator.session_id == "test-session"
        assert orchestrator.state == state
        assert len(orchestrator.unmapped_targets) == 2
    
    def test_map_next_batch(self):
        """Test batch-by-batch mapping."""
        state = MappingState()
        state.word_summary = Mock(fields=[
            Mock(label="field1", placeholder="[field1]"),
            Mock(label="field2", placeholder="[field2]"),
            Mock(label="field3", placeholder="[field3]")
        ])
        
        orchestrator = ProgressiveMappingOrchestrator(
            session_id="batch-test",
            state=state,
            checkpoint_dir=self.checkpoint_dir
        )
        
        # Mock ranked APIs
        ranked_apis = [
            {'operation': Mock(operation_id="op1", input_attributes=[], output_attributes=[])},
            {'operation': Mock(operation_id="op2", input_attributes=[], output_attributes=[])}
        ]
        
        # Mock mapping function
        def mock_map_func(operation, targets, history):
            # Map first target
            if targets:
                return [{
                    'target_name': targets[0]['name'],
                    'source_name': f"{operation.operation_id}_field",
                    'confidence': 0.9
                }]
            return []
        
        # First batch
        result1 = orchestrator.map_next_batch(ranked_apis, mock_map_func, batch_size=1)
        
        assert result1['status'] == 'in_progress'
        assert result1['progress']['mapped_operations'] == 1
        assert len(result1['mappings']) > 0
        
        # Second batch
        result2 = orchestrator.map_next_batch(ranked_apis, mock_map_func, batch_size=1)
        
        assert result2['progress']['mapped_operations'] == 2
    
    def test_checkpoint_persistence(self):
        """Test that checkpoints are saved and can be loaded."""
        state = MappingState()
        state.word_summary = Mock(fields=[Mock(label="field1", placeholder="[field1]")])
        
        orchestrator1 = ProgressiveMappingOrchestrator(
            session_id="checkpoint-test",
            state=state,
            checkpoint_dir=self.checkpoint_dir
        )
        
        ranked_apis = [
            {'operation': Mock(operation_id="op1", input_attributes=[], output_attributes=[])}
        ]
        
        def mock_map_func(operation, targets, history):
            return [{'target_name': 'field1', 'source_name': 'mapped', 'confidence': 0.9}]
        
        # Map and save checkpoint
        orchestrator1.map_next_batch(ranked_apis, mock_map_func, batch_size=1)
        
        # Create new orchestrator with same session
        orchestrator2 = ProgressiveMappingOrchestrator(
            session_id="checkpoint-test",
            state=state,
            checkpoint_dir=self.checkpoint_dir
        )
        
        # Should load checkpoint
        checkpoint = orchestrator2.load_checkpoint()
        assert checkpoint is not None
        assert checkpoint['progress']['mapped_operations'] == 1
    
    def test_get_all_mappings(self):
        """Test retrieving all mappings from orchestrator."""
        state = MappingState()
        state.word_summary = Mock(fields=[
            Mock(label="field1", placeholder="[field1]"),
            Mock(label="field2", placeholder="[field2]")
        ])
        
        orchestrator = ProgressiveMappingOrchestrator(
            session_id="all-mappings-test",
            state=state,
            checkpoint_dir=self.checkpoint_dir
        )
        
        ranked_apis = [
            {'operation': Mock(operation_id="op1", input_attributes=[], output_attributes=[])}
        ]
        
        def mock_map_func(operation, targets, history):
            return [
                {'target_name': t['name'], 'source_name': f"mapped_{t['name']}", 'confidence': 0.9}
                for t in targets
            ]
        
        orchestrator.map_next_batch(ranked_apis, mock_map_func, batch_size=1)
        
        all_mappings = orchestrator.get_all_mappings()
        
        assert len(all_mappings) == 2
        assert all(m['confidence'] == 0.9 for m in all_mappings)


class TestEndToEndIntegration:
    """End-to-end integration tests using real Word and Swagger files."""
    
    @pytest.mark.skipif(
        not WORD_FILE.exists() or not SWAGGER_FILE.exists(),
        reason="Test files not found"
    )
    def test_full_workflow(self):
        """Test complete workflow from Swagger + Word to mappings."""
        # Parse Swagger
        swagger_summary = parse_swagger(str(SWAGGER_FILE))
        assert len(swagger_summary.operations) > 0
        
        # Parse Word
        word_summary = parse_word_document(str(WORD_FILE))
        assert len(word_summary.fields) > 0
        
        # Rank APIs (mock embedding generator)
        def mock_gen(texts):
            return [[0.5, 0.5, 0.0] for _ in texts]
        
        with patch('components.mapping_agents.swagger_relevance.cosine_similarity',
                   return_value=[[0.7]]):
            
            engine = SwaggerRelevanceEngine(swagger_summary, word_summary, mock_gen)
            ranked_apis = engine.rank_apis_by_relevance(top_k=5, confidence_threshold=0.3)
            
            assert len(ranked_apis) > 0
            assert ranked_apis[0]['relevance_score'] >= 0.3
    
    @pytest.mark.skipif(not WORD_FILE.exists(), reason="Word file not found")
    def test_word_parser_extracts_insurance_fields(self):
        """Test that Word parser correctly extracts insurance proposal fields."""
        word_summary = parse_word_document(str(WORD_FILE))
        
        field_labels = [f.label for f in word_summary.fields]
        
        # Check for expected insurance fields
        assert any("employer" in label.lower() for label in field_labels)
        assert any("broker" in label.lower() for label in field_labels)
        assert any("effective date" in label.lower() for label in field_labels)
        assert any("lives" in label.lower() or "eligible" in label.lower() 
                   for label in field_labels)
        
        # Verify field count matches expected dynamic fields
        assert len(word_summary.fields) > 100  # Should have many fields


@pytest.fixture
def mock_flask_app():
    """Create Flask app for endpoint testing."""
    from components.mapping_api import create_app
    app = create_app()
    app.config['TESTING'] = True
    return app


class TestMappingAPIEndpoints:
    """Test REST API endpoints."""
    
    def test_parse_swagger_endpoint(self, mock_flask_app):
        """Test POST /mapping/parse/swagger endpoint."""
        if not SWAGGER_FILE.exists():
            pytest.skip("Swagger file not found")
        
        with mock_flask_app.test_client() as client:
            with open(SWAGGER_FILE, 'rb') as f:
                response = client.post(
                    '/mapping/parse/swagger',
                    data={'swagger_file': (f, 'test.yaml')},
                    content_type='multipart/form-data'
                )
            
            assert response.status_code == 201
            data = json.loads(response.data)
            assert data['status'] == 'success'
            assert 'operations' in data
            assert len(data['operations']) > 0
    
    def test_parse_swagger_invalid_extension(self, mock_flask_app):
        """Test that invalid file extension is rejected."""
        with mock_flask_app.test_client() as client:
            response = client.post(
                '/mapping/parse/swagger',
                data={'swagger_file': (b'content', 'test.txt')},
                content_type='multipart/form-data'
            )
            
            assert response.status_code == 400
            data = json.loads(response.data)
            assert 'error' in data


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
